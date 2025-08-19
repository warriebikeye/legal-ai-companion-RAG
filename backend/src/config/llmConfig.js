import dotenv from 'dotenv';
dotenv.config();

export const DEFAULT_LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';

// Country → LLM map
export const LLM_COUNTRY_MAP = {
  nigeria: 'gemini',
  uk: 'openai',
  usa: 'openai',
  kenya: 'gemini',
  ghana: 'gemini',
  india: 'gemini',
};
