// src/services/documentTemplate.service.js
//
// Builds and persists the `Document` row backing the template-preserving
// "Download Revised Document" feature: a canonical DOCX (native passthrough,
// or Gotenberg-converted for pdf/image origin) plus its paragraph table.
//
// Every entry point here is failure-isolated by design — an unsupported
// format, an unreachable Gotenberg service, or a scanned/image-only source
// with no extractable text all resolve to `null` rather than throwing, so
// the existing chat/clause-analysis flow this plugs into never breaks
// because of this feature. The frontend simply doesn't show a "Download
// Revised Document" affordance for a message with no Document behind it.

import { v4 as uuidv4 } from "uuid";
import { convertToDocx } from "./gotenberg.service.js";
import { extractParagraphs, paragraphsToText } from "./docxStructure.service.js";
import { uploadRawDocument } from "../utils/cloudinary.js";
import Document from "../models/Document.js";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Mirrors the `extractedText.length < 30` sanity check documentProcessor.service.js
// already uses elsewhere — below this, treat the source as having no real
// editable content (e.g. a scanned page Gotenberg embedded as a raster
// image rather than text) rather than persisting an unusable template.
const MIN_TEMPLATE_TEXT_LENGTH = 30;

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[DOCUMENT_TEMPLATE] [${timestamp}] ${step}`, data)
    : console.log(`[DOCUMENT_TEMPLATE] [${timestamp}] ${step}`);
}

export function sourceFormatForMimetype(mimetype) {
  if (mimetype === DOCX_MIME) return "docx";
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype?.startsWith("image/")) return "image";
  return null;
}

/**
 * Creates the persisted Document row for a single uploaded file.
 * `nativeParagraphs` lets the caller pass along paragraphs it already
 * parsed for a native .docx upload, avoiding a second parse of the same
 * buffer. Returns the new Document's _id, or null if no template could be
 * produced (never throws).
 */
export async function createDocumentTemplate({
  file,
  userId,
  conversationId,
  nativeParagraphs = null,
}) {
  const sourceFormat = sourceFormatForMimetype(file.mimetype);
  if (!sourceFormat) return null;

  try {
    let docxBuffer;
    let paragraphs;

    if (sourceFormat === "docx") {
      docxBuffer = file.buffer;
      paragraphs = nativeParagraphs || extractParagraphs(docxBuffer);
    } else {
      docxBuffer = await convertToDocx(file.buffer, file.originalname);
      paragraphs = extractParagraphs(docxBuffer);
    }

    const text = paragraphsToText(paragraphs);
    if (text.length < MIN_TEMPLATE_TEXT_LENGTH) {
      log("Template has no usable text, skipping (likely a scanned image)", {
        filename: file.originalname,
        sourceFormat,
      });
      return null;
    }

    const publicId = `documents/${userId}/${uuidv4()}`;
    const uploadResult = await uploadRawDocument(docxBuffer, { publicId });

    const doc = await Document.create({
      userId,
      conversationId,
      originalFilename: file.originalname,
      originalMimetype: file.mimetype,
      sourceFormat,
      docxPublicId: uploadResult.public_id,
      docxUrl: uploadResult.secure_url,
      paragraphs,
    });

    log("Document template created", { documentId: doc._id.toString(), sourceFormat });
    return doc._id;
  } catch (err) {
    console.warn(
      `⚠️ Document template creation failed for ${file.originalname} (non-fatal):`,
      err.message
    );
    return null;
  }
}

/**
 * Backfills a Document's messageId once the uploading user Message has
 * been persisted (processFiles runs, and therefore creates the Document,
 * before the Message that references it exists — see ask.controller.js).
 */
export async function linkDocumentToMessage(documentId, messageId) {
  if (!documentId) return;
  try {
    await Document.updateOne({ _id: documentId }, { $set: { messageId } });
  } catch (err) {
    console.warn("⚠️ Failed to link Document to message (non-fatal):", err.message);
  }
}
