import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function getEmbedding(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text,
  });
  return res.data[0].embedding;
}

export async function getAnswer(query, context, systemPrompt) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Query: ${query}\n\nRelevant Law:\n${context}` },
    ],
  });

  return res.choices[0].message.content;
}
