// src/services/gotenberg.service.js
//
// Thin HTTP client for a self-hosted Gotenberg instance (LibreOffice
// wrapped behind a warm HTTP service — see gotenberg.dev). We never spawn
// `soffice` in-process: every conversion is a multipart POST to GOTENBERG_URL,
// so swapping deployment target (Render today, GCP/Cloud Run/GKE later) is
// just an env var change, nothing in this file moves.

import axios from "axios";
import FormData from "form-data";

const CONVERT_ENDPOINT = "/forms/libreoffice/convert";
const REQUEST_TIMEOUT_MS = 30000;

function log(step, data = null) {
  const timestamp = new Date().toISOString();
  data
    ? console.log(`[GOTENBERG] [${timestamp}] ${step}`, data)
    : console.log(`[GOTENBERG] [${timestamp}] ${step}`);
}

async function convert(buffer, filename, { attempt = 1 } = {}) {
  const baseUrl = process.env.GOTENBERG_URL;
  if (!baseUrl) {
    throw new Error("GOTENBERG_URL not configured");
  }

  const form = new FormData();
  form.append("files", buffer, { filename });

  try {
    const response = await axios.post(`${baseUrl}${CONVERT_ENDPOINT}`, form, {
      headers: form.getHeaders(),
      responseType: "arraybuffer",
      timeout: REQUEST_TIMEOUT_MS,
    });
    return Buffer.from(response.data);
  } catch (err) {
    if (attempt < 2) {
      log("Conversion failed, retrying once", { filename, error: err.message });
      return convert(buffer, filename, { attempt: attempt + 1 });
    }
    throw err;
  }
}

/**
 * Converts an arbitrary LibreOffice-readable document (PDF, image, etc.)
 * to DOCX. Gotenberg's LibreOffice route picks the output format from the
 * request filename's extension, so we just rename on the way in.
 */
export async function convertToDocx(buffer, filename) {
  const started = Date.now();
  log("convertToDocx started", { filename, size: buffer.length });
  const targetName = filename.replace(/\.[^.]+$/, "") + ".docx";
  const result = await convert(buffer, targetName);
  log("convertToDocx completed", { filename, durationMs: Date.now() - started });
  return result;
}

/**
 * Converts a DOCX buffer to PDF (used for the optional "download as PDF"
 * re-render of a patched, DOCX-origin document).
 */
export async function convertDocxToPdf(buffer, filename) {
  const started = Date.now();
  log("convertDocxToPdf started", { filename, size: buffer.length });
  const targetName = filename.replace(/\.[^.]+$/, "") + ".pdf";
  const result = await convert(buffer, targetName);
  log("convertDocxToPdf completed", { filename, durationMs: Date.now() - started });
  return result;
}
