import express from 'express';
import multer from 'multer';
import { transcribeAndAnswer } from '../controllers/voice.controller.js';

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Voice
 *   description: Voice-to-text legal queries
 */

/**
 * @swagger
 * /voice/voice:
 *   post:
 *     summary: Ask a legal question using a voice note
 *     tags: [Voice]
 *     consumes:
 *       - multipart/form-data
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: The voice file (e.g., .mp3, .wav)
 *               country:
 *                 type: string
 *                 description: Country to use for legal context
 *                 example: nigeria
 *     responses:
 *       200:
 *         description: Returns transcribed query and legal answer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 query:
 *                   type: string
 *                 answer:
 *                   type: string
 *                 sources:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Voice processing failed
 */
router.post('/voice', upload.single('audio'), transcribeAndAnswer);

export default router;
