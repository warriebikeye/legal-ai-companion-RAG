// src/services/documentGeneration.service.js
//
// The actual "apply accepted revisions to the original document" pipeline,
// run by documentGeneration.worker.js. Kept out of the worker file itself,
// mirroring how documentProcessor.service.js holds the ingestion worker's
// logic — the worker is just BullMQ plumbing calling this.

import axios from "axios";
import GeneratedDocument from "../models/GeneratedDocument.js";
import Document from "../models/Document.js";
import Message from "../models/Message.js";
import { resolveAnchors } from "./clauseAnchor.service.js";
import { findSignatureAnchor } from "./signatureDetector.service.js";
import { applyRevisions } from "./docxPatcher.service.js";
import { convertDocxToPdf } from "./gotenberg.service.js";
import { uploadRawDocument } from "../utils/cloudinary.js";
import { documentExpiryQueue } from "../queue/documentExpiry.queue.js";

export const GENERATED_DOC_TTL_MS =
  Number(process.env.GENERATED_DOC_TTL_MS) || 20 * 60 * 1000;

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[DOCUMENT_GENERATION] [${timestamp}] ${step}`, data)
    : console.log(`[DOCUMENT_GENERATION] [${timestamp}] ${step}`);
}

async function fetchDocxBuffer(url) {
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  return Buffer.from(response.data);
}

/**
 * Turns a resolved clause anchor + issue into a docxPatcher operation.
 * `unresolved` anchors are dropped by the caller before this runs — they
 * were never confidently placed, so the safest thing is to leave that
 * clause untouched rather than guess.
 */
function buildOperation(issue, anchor, signatureAnchor) {
  if (anchor.insertBeforeSignature) {
    const heading = issue.clause ? `${issue.clause}\n` : "";
    return {
      type: "insert",
      atIndex: signatureAnchor.insertIndex,
      newText: `${heading}${issue.suggestedRevision}`,
    };
  }
  return {
    type: "replace",
    paragraphIndex: anchor.paragraphIndex,
    newText: issue.suggestedRevision,
  };
}

/**
 * Runs the full generation pipeline for one GeneratedDocument row:
 * fetch the original template, anchor + apply the accepted revisions,
 * optionally re-render to PDF, upload the result, and schedule its
 * 20-minute expiry.
 */
export async function generateRevisedDocument(generatedDocumentId) {
  const started = Date.now();
  const generatedDoc = await GeneratedDocument.findById(generatedDocumentId);
  if (!generatedDoc) {
    throw new Error(`GeneratedDocument ${generatedDocumentId} not found`);
  }

  try {
    generatedDoc.status = "processing";
    await generatedDoc.save();

    const [document, message] = await Promise.all([
      Document.findById(generatedDoc.documentId),
      Message.findById(generatedDoc.messageId),
    ]);

    if (!document) throw new Error("Source document template not found");
    if (!message?.clauseAnalysis?.issues) throw new Error("Source clause analysis not found");

    const allIssues = message.clauseAnalysis.issues;
    const selectedIssues = generatedDoc.appliedIssueIndices
      .map((i) => allIssues[i])
      .filter(Boolean);

    if (!selectedIssues.length) {
      throw new Error("No valid issues selected for this generation");
    }

    log("Resolving clause anchors", {
      generatedDocumentId,
      issueCount: selectedIssues.length,
    });

    const anchors = await resolveAnchors(selectedIssues, document.paragraphs);
    const signatureAnchor = findSignatureAnchor(document.paragraphs);

    const operations = [];
    const skipped = [];
    selectedIssues.forEach((issue, i) => {
      const anchor = anchors[i];
      if (anchor.unresolved) {
        skipped.push(issue.clause);
        return;
      }
      operations.push(buildOperation(issue, anchor, signatureAnchor));
    });

    if (skipped.length) {
      log("Some issues could not be anchored and were skipped", { skipped });
    }
    if (!operations.length) {
      throw new Error("None of the selected issues could be anchored to the document");
    }

    const originalBuffer = await fetchDocxBuffer(document.docxUrl);
    const patchedBuffer = applyRevisions(originalBuffer, operations);

    const outputBuffer =
      generatedDoc.outputFormat === "pdf"
        ? await convertDocxToPdf(patchedBuffer, document.originalFilename)
        : patchedBuffer;

    const publicId = `generated-documents/${generatedDoc.userId}/${generatedDoc._id}`;
    const uploadResult = await uploadRawDocument(outputBuffer, { publicId });

    const expiresAt = new Date(Date.now() + GENERATED_DOC_TTL_MS);

    generatedDoc.status = "completed";
    generatedDoc.resultPublicId = uploadResult.public_id;
    generatedDoc.resultUrl = uploadResult.secure_url;
    generatedDoc.expiresAt = expiresAt;
    await generatedDoc.save();

    await documentExpiryQueue.add(
      "delete-generated-doc",
      { generatedDocumentId: generatedDoc._id.toString() },
      { delay: GENERATED_DOC_TTL_MS }
    );

    log("Generation completed", {
      generatedDocumentId,
      appliedOperations: operations.length,
      skipped: skipped.length,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    console.error("❌ Document generation failed", {
      generatedDocumentId,
      message: err?.message,
      stack: err?.stack,
    });
    generatedDoc.status = "failed";
    generatedDoc.errorMessage = err?.message || "Generation failed";
    await generatedDoc.save();
    throw err;
  }
}
