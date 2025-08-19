import { getRAGAnswer } from '../services/rag.service.js';

export async function handleTextQuery(req, res) {
  try {
    const { query, country = 'nigeria', topK = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const { answer, sources } = await getRAGAnswer(query, country.toLowerCase(), topK);

    res.json({
      answer: `${answer}\n\n🗂 Source${sources.length > 1 ? 's' : ''}: ${sources.join(', ')}`,
      sources
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}
