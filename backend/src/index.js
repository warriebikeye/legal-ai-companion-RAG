// src/index.js
import express from 'express';
import dotenv from 'dotenv';
import passport from "passport";
import session from "express-session";
import cors from 'cors';
import mongoose from "mongoose";
import MongoStore from "connect-mongo";

import { swaggerUi, specs } from './docs/swagger.js';

import askRoutes from './routes/ask.js';
import voiceRoutes from './routes/voice.js';
import ingestRoutes from './routes/ingest.js';
import violationRoutes from './routes/violation.route.js';
import authRoutes from "./routes/auth.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";

import './config/passport.js';

dotenv.config();

async function startServer() {
  try {
    // =========================================================
    // ✅ MongoDB connection (FIRST)
    // =========================================================
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected");

    const app = express();

    // =========================================================
    // CORS
    // =========================================================
    const corsOptions = {
      origin: process.env.NODE_ENV === 'production'
        ? process.env.CLIENT_URL_PROD
        : process.env.CLIENT_URL_TEST,
      methods: ["GET", "POST"],
      credentials: true,
    };

    app.use(cors(corsOptions));

    // =========================================================
    // JSON
    // =========================================================
    app.use(express.json());
    app.set('trust proxy', 1);

    // =========================================================
    // Session (persistent)
    // =========================================================
    app.use(session({
      secret: process.env.SESSION_SECRET || 'supersecret',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: "sessions",
        ttl: 24 * 60 * 60,
      }),
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      },
    }));

    // =========================================================
    // Passport
    // =========================================================
    app.use(passport.initialize());
    app.use(passport.session());

    // =========================================================
    // Routes
    // =========================================================
    app.use("/auth", authRoutes);
    app.use("/ask", askRoutes);
    app.use("/ask", voiceRoutes);
    app.use("/ask", ingestRoutes);
    app.use("/report", violationRoutes);
    app.use("/", conversationRoutes);

    // =========================================================
    // Swagger
    // =========================================================
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

    // =========================================================
    // Root
    // =========================================================
    app.get('/', (req, res) => res.send('🌍 Legal RAG backend running.'));

    // =========================================================
    // Start server
    // =========================================================
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`✅ Server listening on port ${PORT}`);
    });

  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
