import { qdrant } from './qdrant.js';
import dotenv from 'dotenv';

dotenv.config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_API_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const countries = ['nigeria', 'kenya', 'ghana'];

for (const country of countries) {
  const collectionName = `legal_chunks_${country}`;
  const exists = await qdrant.getCollections()
    .then(res => res.collections.some(c => c.name === collectionName));

  if (!exists) {
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: 1536,     // required by OpenAI/Gemini embeddings
        distance: 'Cosine',
      },
    });
    console.log(`✅ Created: ${collectionName}`);
  } else {
    console.log(`⚠️ Already exists: ${collectionName}`);
  }
}
