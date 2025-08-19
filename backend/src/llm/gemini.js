import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const chatModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
const embedModel = genAI.getGenerativeModel({ model: 'embedding-001' });

export async function getEmbedding(text) {
  const result = await embedModel.embedContent(text);
  return result.embedding.values;
}

export async function getAnswer(query, context, systemPrompt) {
  try {
    const prompt = `${systemPrompt}\n\nQuery: ${query}\n\nContext:\n${context}`;
    const result = await chatModel.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('❌ Gemini answer error:', err.message || err);
    throw err;
  }
}