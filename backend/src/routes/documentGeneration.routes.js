// src/routes/documentGeneration.routes.js
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  generateDocument,
  getGenerationStatus,
  downloadGeneratedDocument,
} from "../controllers/documentGeneration.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Documents
 *   description: Template-preserving revised-document generation
 */

/**
 * @swagger
 * /documents/{messageId}/generate:
 *   post:
 *     summary: Generate a revised document from accepted clause suggestions
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [appliedIssueIndices]
 *             properties:
 *               appliedIssueIndices:
 *                 type: array
 *                 items: { type: integer }
 *               outputFormat:
 *                 type: string
 *                 enum: [docx, pdf]
 *     responses:
 *       202:
 *         description: Generation queued
 *       400:
 *         description: Invalid request
 *       404:
 *         description: No source document/template found
 */
router.post("/:messageId/generate", requireAuth, generateDocument);

/**
 * @swagger
 * /documents/generated/{id}/status:
 *   get:
 *     summary: Poll the status of a document generation job
 *     tags: [Documents]
 */
router.get("/generated/:id/status", requireAuth, getGenerationStatus);

/**
 * @swagger
 * /documents/generated/{id}/download:
 *   get:
 *     summary: Download a completed generated document
 *     tags: [Documents]
 *     responses:
 *       302:
 *         description: Redirects to the file
 *       410:
 *         description: Download has expired
 */
router.get("/generated/:id/download", requireAuth, downloadGeneratedDocument);

export default router;
