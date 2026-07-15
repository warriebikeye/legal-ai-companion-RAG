// src/config/countries.js
//
// Canonical list of jurisdictions with ingested legal content.
// `slug` must match the Qdrant collection naming convention used by
// both ingestion (ingest.service.js) and retrieval (rag.service.js):
// `legal_chunks_${slug}-gm`. Keep this in sync with the frontend's
// country dropdown (ai-legal-frontend/src/pages/HomePage.jsx).

export const SUPPORTED_COUNTRIES = [
  { name: "Nigeria",      slug: "nigeria",      aliases: ["nigeria", "nigerian"] },
  { name: "Kenya",        slug: "kenya",        aliases: ["kenya", "kenyan"] },
  { name: "Ghana",        slug: "ghana",        aliases: ["ghana", "ghanaian", "ghanian"] },
  { name: "South Africa", slug: "south africa", aliases: ["south africa", "south african"] },
  { name: "Tanzania",     slug: "tanzania",     aliases: ["tanzania", "tanzanian"] },
  { name: "Liberia",      slug: "liberia",      aliases: ["liberia", "liberian"] },
];
