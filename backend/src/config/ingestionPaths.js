// src/config/ingestionPaths.js
//
// Root of the local drop-folder tree used by POST /ask/train/folder.
// Layout: <root>/<Country name>/TO   — PDFs waiting to be ingested
//         <root>/<Country name>/DONE — PDFs already ingested (or recognized as duplicates)

export const INGESTION_ROOT =
  process.env.CORPUS_INGESTION_ROOT || "C:\\Users\\HomePC\\Desktop\\Clauz-ingestion";
