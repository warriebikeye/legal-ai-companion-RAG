import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { qdrant } from '../vectorstore/qdrant.js';
import { extractText } from '../utils/extractText.js';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Gemini embedding size
const GEMINI_EMBED_DIM = 768;

function cleanText(text) {
  return text
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureCollection(collectionName) {
  try {
    const collections = await qdrant.getCollections();
    if (!collections.collections.find(c => c.name === collectionName)) {
      console.log(`🆕 Creating Qdrant collection: ${collectionName}`);
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: GEMINI_EMBED_DIM, // ✅ always 768 for Gemini
          distance: 'Cosine',
        },
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (err) {
    if (err.statusCode === 409) {
      console.log(`⚠️ Collection ${collectionName} already exists`);
    } else {
      console.error('❌ Failed to check/create collection:', err);
      throw err;
    }
  }
}

async function uploadInBatches(collectionName, points, batchSize = 100) {
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await qdrant.upsert(collectionName, { points: batch });
    console.log(`📤 Uploaded batch ${i / batchSize + 1} (${batch.length} points)`);
  }
}

export async function ingestFile(file, country) {
  console.log(`📥 Ingesting file: ${file.originalname} for country: ${country}`);

  // 👇 Expect extractText to return [{ text, page }]
  const rawChunks = await extractText(file.path, file.mimetype);

  const seenChunks = new Set();
  const paragraphs = rawChunks
    .map(({ text, page }) => ({
      text: cleanText(text),
      page,
    }))
    .filter(p => p.text !== '' && !seenChunks.has(p.text) && seenChunks.add(p.text));

  console.log(`📄 Cleaned to ${paragraphs.length} unique, non-empty paragraphs`);

  const collection = `legal_chunks_${country.toLowerCase()}-gm`;
  await ensureCollection(collection);

  console.log(`🔄 Preparing to upload ${paragraphs.length} chunks to collection: ${collection}`);

  const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
  const points = [];

  for (let i = 0; i < paragraphs.length; i++) {
  let { text: chunk, page } = paragraphs[i];

  if (chunk.length > 3000) {
    console.warn(`⚠️ Chunk ${i} too long (${chunk.length} chars). Truncating.`);
    chunk = chunk.slice(0, 3000);
  }

  try {
    const result = await embeddingModel.embedContent({
      content: { parts: [{ text: chunk }] },
    });

    const vector = result.embedding.values;

    points.push({
      id: uuidv4(),
      vector,
      payload: {
        text: chunk,
        country,
        source: path.basename(file.path), // ✅ fixed
        page,                             // ✅ fixed
      },
    });
  } catch (err) {
    console.error(`⚠️ Embedding failed for chunk ${i}: ${err.message}`);
  }
}


  if (points.length) {
    await uploadInBatches(collection, points);
    console.log(`✅ Uploaded ${points.length} chunks to ${collection}`);
  } else {
    console.warn(`⚠️ No valid chunks found in ${file.originalname}`);
  }

  console.log(`🗑️ Cleaning up temporary file: ${file.path}`);
  await fs.unlink(file.path);
}
