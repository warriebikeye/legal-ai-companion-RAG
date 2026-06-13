import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  listConversations,
  getConversationMessages,
} from "../controllers/conversation.controller.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Conversations
 *   description: Conversation history endpoints (requires Google OAuth session)
 */

/**
 * @swagger
 * /conversations:
 *   get:
 *     summary: List all conversations for the authenticated user
 *     tags: [Conversations]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Returns the list of conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 conversations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: 65b2f23bd8c2a3a9a9e12abc
 *                       title:
 *                         type: string
 *                         example: New Chat
 *                       country:
 *                         type: string
 *                         example: nigeria
 *                       lastMessageAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-01-19T10:30:00.000Z
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-01-19T10:00:00.000Z
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-01-19T10:30:00.000Z
 *       401:
 *         description: Unauthorized (user not authenticated)
 *       500:
 *         description: Server error
 */
router.get("/", requireAuth, listConversations);

/**
 * @swagger
 * /conversations/{conversationId}/messages:
 *   get:
 *     summary: Get all messages for a specific conversation
 *     tags: [Conversations]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: string
 *         description: The conversation ID
 *         example: 65b2f23bd8c2a3a9a9e12abc
 *     responses:
 *       200:
 *         description: Returns conversation messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: 65b2f29fd8c2a3a9a9e12def
 *                       conversationId:
 *                         type: string
 *                         example: 65b2f23bd8c2a3a9a9e12abc
 *                       role:
 *                         type: string
 *                         enum: [user, assistant, system]
 *                         example: user
 *                       content:
 *                         type: string
 *                         example: Can police arrest me without a warrant?
 *                       sources:
 *                         type: array
 *                         items:
 *                           type: string
 *                         example: ["constitution_ng.pdf", "criminal_procedure_act.pdf"]
 *                       clauseAnalysis:
 *                         nullable: true
 *                         example: null
 *                       documentText:
 *                         type: string
 *                         nullable: true
 *                         example: null
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-01-19T10:05:00.000Z
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                         example: 2026-01-19T10:05:00.000Z
 *       401:
 *         description: Unauthorized (user not authenticated)
 *       404:
 *         description: Conversation not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:conversationId/messages",
  requireAuth,
  getConversationMessages
);

export default router;
