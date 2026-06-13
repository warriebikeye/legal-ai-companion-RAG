// src/middleware/encryption.js
//
// AES-256-GCM symmetric encryption middleware.
//
// What it does:
//   - Decrypts incoming encrypted request bodies before the route handler runs
//   - Encrypts outgoing JSON responses after the route handler finishes
//   - Skips response encryption for SSE streams (Content-Type: text/event-stream)
//     because chunks are sent incrementally and cannot be buffered + encrypted
//   - Request bodies going INTO streaming routes are still decrypted normally
//
// Shared secret:
//   Set ENCRYPTION_SECRET in your .env. The same value must be set in the
//   React frontend .env as REACT_APP_ENCRYPTION_SECRET.
//
//   Key derivation: AES key = SHA-256(ENCRYPTION_SECRET)
//   The frontend MUST derive its key the exact same way
//   (see src/utils/encryption.js getDerivedKey).
//
// Wire-format for encrypted payloads (request body and response body):
//   {
//     "iv":         "<hex>",   // 12-byte random IV
//     "tag":        "<hex>",   // 16-byte GCM auth tag
//     "ciphertext": "<hex>"    // encrypted content
//   }
//
// Usage in server.js:
//   import { decryptRequest, encryptResponse } from "./middleware/encryption.js";
//   app.use(decryptRequest);
//   app.use(encryptResponse);
//   // ... then mount routes

import crypto from "crypto";

const ALGORITHM  = "aes-256-gcm";
const IV_LENGTH  = 12; // 96-bit IV — recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/* =========================================================
   Key derivation
   AES key = SHA-256(secret) — 32 bytes, matches frontend
========================================================= */
function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/* =========================================================
   Core encrypt / decrypt
========================================================= */
export function encrypt(plaintext, secret) {
  const key        = deriveKey(secret);
  const iv         = crypto.randomBytes(IV_LENGTH);
  const cipher     = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted  = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag        = cipher.getAuthTag();

  return {
    iv:         iv.toString("hex"),
    tag:        tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

export function decrypt(payload, secret) {
  const key        = deriveKey(secret);
  const iv         = Buffer.from(payload.iv, "hex");
  const tag        = Buffer.from(payload.tag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");
  const decipher   = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/* =========================================================
   Helper — is this an encrypted payload?
========================================================= */
function isEncryptedPayload(body) {
  return (
    body &&
    typeof body === "object" &&
    typeof body.iv         === "string" &&
    typeof body.tag        === "string" &&
    typeof body.ciphertext === "string"
  );
}

/* =========================================================
   MIDDLEWARE 1 — Decrypt incoming request body
========================================================= */
export function decryptRequest(req, res, next) {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret) {
    console.warn("[encryption] ENCRYPTION_SECRET not set — skipping decryption");
    return next();
  }

  // Only decrypt if the body looks like an encrypted payload
  if (!isEncryptedPayload(req.body)) {
    return next();
  }

  try {
    const plaintext = decrypt(req.body, secret);
    req.body = JSON.parse(plaintext);
    next();
  } catch (err) {
    console.error("[encryption] Request decryption failed:", err.message);
    return res.status(400).json({ error: "Invalid encrypted payload" });
  }
}

/* =========================================================
   MIDDLEWARE 2 — Encrypt outgoing response body

   Wraps res.json() so every JSON response is transparently
   encrypted before being sent to the client.

   SSE streams (Content-Type: text/event-stream) are skipped
   entirely — the route handler writes directly to the socket
   and buffering is not possible.
========================================================= */
export function encryptResponse(req, res, next) {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret) {
    console.warn("[encryption] ENCRYPTION_SECRET not set — skipping encryption");
    return next();
  }

  // Capture the original res.json
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    // Skip if this is an SSE connection (streaming route)
    const contentType = res.getHeader("Content-Type") || "";
    if (contentType.includes("text/event-stream")) {
      return originalJson(data);
    }

    try {
      const plaintext = JSON.stringify(data);
      const encrypted = encrypt(plaintext, secret);
      // Send encrypted envelope as JSON
      return originalJson(encrypted);
    } catch (err) {
      console.error("[encryption] Response encryption failed:", err.message);
      // Fail safe — send unencrypted rather than break the response
      return originalJson(data);
    }
  };

  next();
}