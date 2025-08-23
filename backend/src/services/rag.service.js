import { qdrant } from '../vectorstore/qdrant.js';
import redis from './redis.js';
import * as geminiLLM from '../llm/gemini.js';

const CACHE_TTL = 60 * 60; // 1 hour

export async function getRAGAnswer(query, country = 'nigeria') {
  const cacheKey = `answer::${country.toLowerCase()}::${query.trim()}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    console.log('💡 Served from Redis cache');
    return JSON.parse(cached);
  }

  // ✅ Gemini-only embedding
  let vector;
  const collection = `legal_chunks_${country.toLowerCase()}-gm`;

  try {
    vector = await geminiLLM.getEmbedding(query);
  } catch (err) {
    console.error(`❌ Embedding failed with Gemini: ${err.message}`);
    throw err; // no fallback anymore
  }

  // ✅ Search Qdrant with Gemini vectors
  const results = await qdrant.search(collection, {
    vector,
    top: 5,
    with_payload: true,
  });

  const contextChunks = results.map(r => r.payload.text);

  // ✅ Sources: just unique document names (no page numbers)
  const sources = [
    ...new Set(
      results
        .map(r => r.payload.source)
        .filter(Boolean)
    ),
  ];

  const context = contextChunks.join('\n\n');
  const systemPrompt = `You are a legal assistant. Use only ${country.toUpperCase()}'s laws to
   answer the user. Be clear, accurate, and helpful.`;

  try {
    // ✅ Generate answer with Gemini
    const answer = await geminiLLM.getAnswer(query, context, systemPrompt);

    const response = { answer, sources };
    await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    return response;
  } catch (err) {
    console.error(`❌ LLM response failed with Gemini: ${err.message}`);
    throw err;
  }
}
