// src/controllers/documentGeneration.controller.js

import Message from "../models/Message.js";
import Document from "../models/Document.js";
import GeneratedDocument from "../models/GeneratedDocument.js";
import { documentGenerationQueue } from "../queue/documentGeneration.queue.js";

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[DOCUMENT_GEN_CONTROLLER] [${timestamp}] ${step}`, data)
    : console.log(`[DOCUMENT_GEN_CONTROLLER] [${timestamp}] ${step}`);
}

/**
 * POST /documents/:messageId/generate
 * body: { appliedIssueIndices: number[], outputFormat?: "docx"|"pdf" }
 *
 * `:messageId` is the ASSISTANT message carrying clauseAnalysis. The
 * uploaded Document template is linked to the preceding USER message, so
 * this walks back to find it — the same relationship the frontend already
 * relies on to backfill documentText after a conversation reload.
 */
export async function generateDocument(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { messageId } = req.params;
    const appliedIssueIndices = req.body?.appliedIssueIndices;
    const outputFormat = req.body?.outputFormat === "pdf" ? "pdf" : "docx";

    if (!Array.isArray(appliedIssueIndices) || appliedIssueIndices.length === 0) {
      return res.status(400).json({ error: "appliedIssueIndices is required" });
    }

    const assistantMessage = await Message.findOne({ _id: messageId, userId });
    if (!assistantMessage) {
      return res.status(404).json({ error: "Message not found" });
    }

    const issues = assistantMessage.clauseAnalysis?.issues || [];
    if (!issues.length) {
      return res.status(400).json({ error: "This message has no clause analysis to apply" });
    }

    const indicesValid = appliedIssueIndices.every(
      (i) => Number.isInteger(i) && i >= 0 && i < issues.length
    );
    if (!indicesValid) {
      return res.status(400).json({ error: "appliedIssueIndices contains an out-of-range index" });
    }

    const userMessage = await Message.findOne({
      conversationId: assistantMessage.conversationId,
      userId,
      role: "user",
      createdAt: { $lte: assistantMessage.createdAt },
    }).sort({ createdAt: -1 });

    if (!userMessage) {
      return res.status(404).json({ error: "No source document found for this message" });
    }

    const document = await Document.findOne({ messageId: userMessage._id });
    if (!document) {
      return res
        .status(404)
        .json({ error: "No downloadable template is available for this document" });
    }

    const generatedDoc = await GeneratedDocument.create({
      userId,
      conversationId: assistantMessage.conversationId,
      documentId: document._id,
      messageId: assistantMessage._id,
      appliedIssueIndices,
      outputFormat,
      status: "pending",
    });

    await documentGenerationQueue.add("generate", {
      generatedDocumentId: generatedDoc._id.toString(),
    });

    log("Generation queued", { generatedDocumentId: generatedDoc._id.toString() });

    return res.status(202).json({
      generatedDocumentId: generatedDoc._id.toString(),
      status: generatedDoc.status,
    });
  } catch (err) {
    console.error("❌ [generateDocument] error:", { message: err?.message, stack: err?.stack });
    return res.status(500).json({ error: err?.message || "Failed to start document generation" });
  }
}

/** GET /documents/generated/:id/status */
export async function getGenerationStatus(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const doc = await GeneratedDocument.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ error: "Not found" });

    return res.json({
      status: doc.status,
      downloadUrl:
        doc.status === "completed" ? `/documents/generated/${doc._id}/download` : null,
      errorMessage: doc.status === "failed" ? doc.errorMessage : null,
    });
  } catch (err) {
    console.error("❌ [getGenerationStatus] error:", { message: err?.message });
    return res.status(500).json({ error: "Failed to fetch generation status" });
  }
}

/** GET /documents/generated/:id/download */
export async function downloadGeneratedDocument(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const doc = await GeneratedDocument.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ error: "Not found" });

    if (doc.deletedAt || (doc.expiresAt && doc.expiresAt < new Date())) {
      return res.status(410).json({ error: "This download has expired — please generate it again." });
    }

    if (doc.status !== "completed" || !doc.resultUrl) {
      return res.status(409).json({ error: `Document is not ready yet (status: ${doc.status})` });
    }

    return res.redirect(302, doc.resultUrl);
  } catch (err) {
    console.error("❌ [downloadGeneratedDocument] error:", { message: err?.message });
    return res.status(500).json({ error: "Failed to download document" });
  }
}
