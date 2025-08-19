import express from 'express';
import multer from 'multer';
import { ingestFile } from '../services/ingest.service.js';

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

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
router.post('/train/multiple', upload.array('files', 10), async (req, res) => {
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

export default router;
