// src/index.js
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
import './config/passport.js'; // Google Passport config

dotenv.config();

const app = express();

// ----------------------
// CORS setup
// ----------------------
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.CLIENT_URL_PROD
    : process.env.CLIENT_URL_TEST,
  methods: ["GET", "POST"],
  credentials: true, // allow cookies to be sent cross-site
};

app.use(cors(corsOptions));

// ----------------------
// JSON parser
// ----------------------
app.use(express.json());
app.set('trust proxy', 1);
// ----------------------
// Session setup
// ----------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false, // recommended for production
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    httpOnly: true,                               // client-side JS cannot access cookie
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // cross-site for OAuth
    maxAge: 24 * 60 * 60 * 1000,                 // 1 day
  },
}));

// ----------------------
// Passport initialization
// ----------------------
app.use(passport.initialize());
app.use(passport.session());

// ----------------------
// Routes
// ----------------------
app.use("/auth", authRoutes);
app.use("/ask", askRoutes);
app.use("/ask", voiceRoutes);
app.use("/ask", ingestRoutes);
app.use("/report", violationRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// ----------------------
// Root route
// ----------------------
app.get('/', (req, res) => res.send('🌍 Legal RAG backend running.'));

// ----------------------
// Start server
// ----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
