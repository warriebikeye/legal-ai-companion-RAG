// src/routes/ask.js
import express from 'express';
import multer from 'multer';
import { requireAuth } from "../middleware/requireAuth.js";
import tokenGate from "../middleware/tokenGate.js";
import {
  handleTextQuery,
  handleTextQueryStream,
} from '../controllers/ask.controller.js';

const upload = multer();
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Ask
 *   description: Legal assistant query endpoints
 */

/**
 * @swagger
 * /ask/text:
 *   post:
 *     summary: Ask a legal question via text
 *     tags: [Ask]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: The legal question you want to ask
 *                 example: Can police arrest me without a warrant?
 *               country:
 *                 type: string
 *                 description: The country to base the law context on
 *                 example: nigeria
 *     responses:
 *       200:
 *         description: Returns legal answer with sources
 *       400:
 *         description: Query is missing
 *       402:
 *         description: Insufficient tokens
 *       500:
 *         description: Server error
 */

// Both routes:
// 1. requireAuth   — user must be logged in
// 2. upload        — multer processes files BEFORE tokenGate runs
// 3. tokenGate     — auto-detects Q&A vs review from req.files
// 4. handler       — only reached if token gate passes

router.post('/text', [
  requireAuth,
  upload.array('files'),
  tokenGate('auto'),
  handleTextQuery,
]);

router.post('/stream', [
  requireAuth,
  upload.array('files'),
  tokenGate('auto'),
  handleTextQueryStream,
]);

export default router;
