import fs from 'fs';
import OpenAI from 'openai';
import { getRAGAnswer } from '../services/rag.service.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function transcribeAndAnswer(req, res) {
  try {
    const { country = 'nigeria' } = req.body;
    const audioPath = req.file.path;

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
    });

    const text = transcription.text;
    console.log(`🎙 Transcribed: ${text}`);

    const { answer, sources } = await getRAGAnswer(text, country);
    fs.unlinkSync(audioPath); // delete temp file

    res.json({
      query: text,
      answer: `${answer}\n\n🗂 Source${sources.length > 1 ? 's' : ''}: ${sources.join(', ')}`,
      sources
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Voice processing failed' });
  }
}
