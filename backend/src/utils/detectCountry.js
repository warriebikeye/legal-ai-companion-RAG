import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function detectCountryFromText(text) {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  const prompt = `
    This text is from a legal or constitutional document. 
    Your task is to guess which country it likely belongs to.
    Respond with just the country name, e.g., "Nigeria", "Kenya", etc.

    TEXT:
    ${text}
  `;

  const result = await model.generateContent(prompt);
  const country = result.response.text().trim();

  return country.toLowerCase();
}
