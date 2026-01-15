import express from 'express';
import { swaggerUi, specs } from './docs/swagger.js';
import dotenv from 'dotenv';
import passport from "passport";
import session from "express-session";
import cors from 'cors'; 
import askRoutes from './routes/ask.js';
import voiceRoutes from './routes/voice.js';
import ingestRoutes from './routes/ingest.js';
import violationRoutes from './routes/violation.route.js';
import authRoutes from "./routes/auth.routes.js";
import './config/passport.js'

dotenv.config();
const app = express();
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' ? process.env.CLIENT_URL_PROD : process.env.CLIENT_URL_TEST,  // Choose the URL based on the environment
  methods: "GET,POST",
  credentials: true,  // Allow cookies to be sent with requests
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',  // Use a secret for session encryption
  resave: false,
  saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRoutes);
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
