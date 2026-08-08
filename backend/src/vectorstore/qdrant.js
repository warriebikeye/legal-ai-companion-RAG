// src/vectorstore/qdrant.js

import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";

dotenv.config();

/* =========================================================
   CLIENT
========================================================= */

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_API_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

/* =========================================================
   COLLECTIONS
========================================================= */

export const USER_DOCS_COLLECTION = "user_uploaded_docs";

/* =========================================================
   HELPERS
========================================================= */

export async function ensurePayloadIndex(collectionName, fieldName, fieldSchema) {
  try {
    await qdrant.createPayloadIndex(collectionName, {
      field_name: fieldName,
      field_schema: fieldSchema,
    });
    console.log(`✅ Payload index created: ${fieldName}`);
  } catch (err) {
    // 409 / "already exists" is fine — any other error re-throw
    const msg = err?.data?.status?.error || err?.message || "";
    if (
      err?.status === 409 ||
      msg.toLowerCase().includes("already exists") ||
      msg.toLowerCase().includes("conflict")
    ) {
      console.log(`✅ Payload index already exists: ${fieldName}`);
    } else {
      throw err;
    }
  }
}

/* =========================================================
   INIT COLLECTIONS
========================================================= */

export async function initializeQdrantCollections() {
  try {
    /* =====================================================
       USER DOCS COLLECTION
    ===================================================== */

    try {
      await qdrant.getCollection(USER_DOCS_COLLECTION);
      console.log("✅ User docs collection exists");
    } catch {
      console.log("Creating user docs collection...");

      await qdrant.createCollection(USER_DOCS_COLLECTION, {
        vectors: {
          size: 3072,
          distance: "Cosine",
        },
      });

      console.log("✅ User docs collection created");
    }

    /* =====================================================
       PAYLOAD INDEXES
       Required for any field used in filter.must clauses.
       Without these Qdrant returns 400 "Index required".
    ===================================================== */

    await ensurePayloadIndex(USER_DOCS_COLLECTION, "conversationId", "keyword");
    await ensurePayloadIndex(USER_DOCS_COLLECTION, "userId", "keyword");
    await ensurePayloadIndex(USER_DOCS_COLLECTION, "documentHash", "keyword");
    await ensurePayloadIndex(USER_DOCS_COLLECTION, "expiresAt", "datetime");
  } catch (err) {
    console.error("❌ Qdrant init failed", err);
    throw err;
  }
}