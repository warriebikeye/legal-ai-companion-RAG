import crypto from "crypto";

export function generateDocumentHash(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}