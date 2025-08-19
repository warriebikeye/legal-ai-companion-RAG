import express from 'express';
import { handleTextQuery } from '../controllers/ask.controller.js';

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                 sources:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: Query is missing
 *       500:
 *         description: Server error
 */
router.post('/text', handleTextQuery);

export default router;
