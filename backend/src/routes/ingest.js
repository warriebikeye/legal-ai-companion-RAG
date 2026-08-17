import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { ingestFile } from '../services/ingest.service.js';
import { folderIngestionQueue } from '../queue/folderIngestion.queue.js';
import { acquireLock, releaseLock } from '../utils/distributedLock.js';
import redis from '../services/redis.js';
import { SUPPORTED_COUNTRIES } from '../config/countries.js';
import { INGESTION_ROOT } from '../config/ingestionPaths.js';
import { stripTrailingHashSegment } from '../utils/filename.js';

// Per-country filename cleanup applied before a file is ingested/saved to
// DONE. Ghana's source PDFs carry a trailing "-<hash>" segment that isn't
// wanted in citations or the archived filename.
const FILENAME_CLEANERS = {
  ghana: stripTrailingHashSegment,
};

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

const PDF_OR_TXT = /\.(pdf|txt)$/i;
const BATCH_LOCK_TTL_SECONDS = 60 * 60 * 4; // safety ceiling in case a worker dies mid-batch

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[FOLDER_INGEST] [${timestamp}] ${step}`, data)
    : console.log(`[FOLDER_INGEST] [${timestamp}] ${step}`);
}

/**
 * @swagger
 * tags:
 *   name: Ingest
 *   description: Upload legal documents to train the AI
 */

/**
 * @swagger
 * /ask/train:
 *   post:
 *     summary: Upload a single legal document for training
 *     tags: [Ingest]
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Legal document (PDF, DOCX, TXT)
 *               country:
 *                 type: string
 *                 description: Country context for the document
 *                 example: nigeria
 *     responses:
 *       200:
 *         description: File successfully ingested
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       500:
 *         description: Ingestion failed
 */
router.post('/train', upload.single('file'), async (req, res) => {
  try {
    await ingestFile(req.file, req.body.country);
    res.json({ message: '✅ File ingested' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ingestion failed' });
  }
});

/**
 * @swagger
 * /ask/train/multiple:
 *   post:
 *     summary: Upload multiple legal documents for training
 *     tags: [Ingest]
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Multiple legal documents
 *               country:
 *                 type: string
 *                 description: Country context for all documents
 *                 example: nigeria
 *     responses:
 *       200:
 *         description: Summary of file upload results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       file:
 *                         type: string
 *                       status:
 *                         type: string
 *                       error:
 *                         type: string
 *       500:
 *         description: Bulk upload failed
 */
router.post('/train/multiple', upload.array('files', 50), async (req, res) => {
  try {
    const results = [];

    for (const file of req.files) {
      try {
        await ingestFile(file, req.body.country);
        results.push({ file: file.originalname, status: '✅ Uploaded' });
      } catch (err) {
        results.push({ file: file.originalname, status: '❌ Failed', error: err.message });
      }
    }

    res.json({ summary: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Bulk upload failed' });
  }
});


/**
 * @swagger
 * /ask/train/folder:
 *   post:
 *     summary: Scan local TO folders and enqueue background ingestion for each country
 *     description: >
 *       Reads PDFs from <INGESTION_ROOT>/<Country>/TO, skips files whose exact
 *       content is already in that country's collection (moved straight to
 *       DONE), and enqueues the rest for background ingestion. Files only
 *       move to DONE after ingestion (or the duplicate check) succeeds.
 *     tags: [Ingest]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               country:
 *                 type: string
 *                 description: Optional single country name to scan (defaults to all supported countries)
 *                 example: Nigeria
 *     responses:
 *       200:
 *         description: Per-country scan/enqueue results
 *       400:
 *         description: Unknown country name
 */
router.post('/train/folder', async (req, res) => {
  const { country } = req.body || {};

  log('Trigger received', { country: country || 'ALL' });

  const targets = country
    ? SUPPORTED_COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase() === String(country).toLowerCase() ||
          c.slug === String(country).toLowerCase()
      )
    : SUPPORTED_COUNTRIES;

  if (country && targets.length === 0) {
    log('Unknown country — aborting', { country });
    return res.status(400).json({ error: `Unknown country: ${country}` });
  }

  const results = [];

  for (const { name, slug } of targets) {
    const lockKey = `lock:folder-ingest:${slug}`;
    const statsKey = `folder-ingest-stats:${slug}`;
    log('Scanning country', { country: name });

    const locked = await acquireLock(lockKey, BATCH_LOCK_TTL_SECONDS);

    if (!locked) {
      log('Batch already in progress — skipping', { country: name });
      results.push({ country: name, status: 'skipped', reason: 'batch already in progress' });
      continue;
    }

    const toDir = path.join(INGESTION_ROOT, name, 'TO');
    const doneDir = path.join(INGESTION_ROOT, name, 'DONE');

    try {
      let entries;
      try {
        entries = await fs.readdir(toDir, { withFileTypes: true });
      } catch {
        log('TO folder not found — skipping', { country: name, toDir });
        results.push({ country: name, status: 'skipped', reason: 'TO folder not found' });
        await releaseLock(lockKey);
        continue;
      }

      const files = entries.filter((e) => e.isFile() && PDF_OR_TXT.test(e.name));
      log('Files found', { country: name, totalEntries: entries.length, matching: files.length });

      if (files.length === 0) {
        log('No matching files — releasing lock', { country: name });
        results.push({ country: name, status: 'ok', enqueued: 0 });
        await releaseLock(lockKey);
        continue;
      }

      // Held by the worker: decremented per finished job, lock released at zero.
      await redis.set(`folder-ingest-remaining:${slug}`, files.length);
      await redis.del(statsKey);

      const cleanName = FILENAME_CLEANERS[slug] || ((n) => n);

      for (const entry of files) {
        const savedFileName = cleanName(entry.name);

        if (savedFileName !== entry.name) {
          log('Cleaned filename', { country: name, original: entry.name, cleaned: savedFileName });
        }

        await folderIngestionQueue.add('ingest-file', {
          country: name,
          slug,
          fileName: savedFileName, // used for source metadata + DONE filename
          filePath: path.join(toDir, entry.name), // real on-disk path, unchanged
          doneDir,
          lockKey,
          statsKey,
        });
        log('Enqueued file', { country: name, fileName: savedFileName });
      }

      log('Country scan complete', { country: name, enqueued: files.length });
      results.push({ country: name, status: 'ok', enqueued: files.length });
    } catch (err) {
      log('Country scan failed', { country: name, error: err.message });
      await releaseLock(lockKey);
      results.push({ country: name, status: 'error', error: err.message });
    }
  }

  log('Trigger handling complete', { results });
  res.json({ message: '📥 Folder ingestion jobs enqueued', results });
});

export default router;
