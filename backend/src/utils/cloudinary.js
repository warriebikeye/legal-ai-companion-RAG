// src/utils/cloudinary.js
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Uploads an avatar image buffer to Cloudinary.
 * Re-uses one public_id per user so re-uploads overwrite the
 * previous avatar instead of accumulating orphaned images.
 */
export function uploadAvatar(buffer, userId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "avatars",
        public_id: String(userId),
        overwrite: true,
        resource_type: "image",
        transformation: [
          { width: 512, height: 512, crop: "fill", gravity: "face" },
          { quality: "auto", fetch_format: "auto" },
        ],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Uploads a non-image document (docx/pdf) buffer as a Cloudinary raw
 * resource — used for the template-preserving document-review feature
 * (the canonical uploaded/converted docx, and later the generated
 * revised-document downloads).
 */
export function uploadRawDocument(buffer, { folder, publicId } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder || "documents",
        public_id: publicId,
        overwrite: true,
        resource_type: "raw",
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/** Deletes a Cloudinary raw resource by public_id. */
export function deleteRawDocument(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
}
