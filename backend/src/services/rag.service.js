import { qdrant } from '../vectorstore/qdrant.js';
import redis from './redis.js';
import * as geminiLLM from '../llm/gemini.js';

const CACHE_TTL = 60 * 60; // 1 hour

export async function getRAGAnswer(query, country = 'nigeria',extraContext = "") {
  const cacheKey = `answer::${country}::${query}::${extraContext.slice(0,200)}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
  console.log('💡 Served from Redis cache');
  return typeof cached === "string" ? JSON.parse(cached) : cached;
}

  // ✅ Gemini-only embedding
  let vector;
  const collection = `legal_chunks_${country.toLowerCase()}-gm`;
  console.log('💡getting vector');
  try {
    vector = await geminiLLM.getEmbedding(query);
  } catch (err) {
    console.error(`❌ Embedding failed with Gemini: ${err.message}`);
    throw err; // no fallback anymore
  }

  // ✅ Search Qdrant with Gemini vectors
  console.log('💡 searching qdrant');
  const results = await qdrant.search(collection, {
    vector,
    top: 5,
    with_payload: true,
  });

  const contextChunks = results.map(r => r.payload.text);
  const fullContext = (extraContext ? (extraContext + "\n\n") : "") + contextChunks.join("\n\n");
  // ✅ Sources: just unique document names (no page numbers)
  const sources = [
    ...new Set(
      results
        .map(r => r.payload.source)
        .filter(Boolean)
    ),
  ];

  const systemPrompt = `You are a legal assistant providing information based on ${country.toUpperCase()}'s laws.

Use the provided context to answer the user's question clearly and accurately.

IMPORTANT RULES:
- Do NOT include any file names, document IDs, or source codes in your answer.
- Only include citations or references if they are legal sections (e.g., "Section 35 of the Constitution").
- The assistant response must be a clean explanation or legal guidance only.
- The list of source document IDs will be handled separately by the system. Do not mention or reference them inside the main answer.`;


  try {
    // ✅ Generate answer with Gemini
    console.log('💡 Generating response');
    const answer = await geminiLLM.getAnswer(query, fullContext, systemPrompt);

    const response = { answer, sources };
    //await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    await redis.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL });
    return response;
  } catch (err) {
    console.error(`❌ LLM response failed with Gemini: ${err.message}`);
    throw err;
  }
}
