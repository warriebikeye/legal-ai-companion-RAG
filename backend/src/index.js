import express from 'express';
import { swaggerUi, specs } from './docs/swagger.js';
import dotenv from 'dotenv';
import cors from 'cors'; 
import askRoutes from './routes/ask.js';
import voiceRoutes from './routes/voice.js';
import ingestRoutes from './routes/ingest.js';
import violationRoutes from './routes/violation.route.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
app.use('/ask', askRoutes);
app.use('/ask', voiceRoutes);
app.use('/ask', ingestRoutes);
app.use('/report', violationRoutes);

app.get('/', (req, res) => res.send('🌍 Legal RAG backend running.'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server listening at http://localhost:${PORT}`);
});
