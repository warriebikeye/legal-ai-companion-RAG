import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { scheduleDailyReset } from "./cron/dailyReset.js";
scheduleDailyReset();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

/* =========================================================
   QDRANT INIT
========================================================= */
import { initializeQdrantCollections } from "./vectorstore/qdrant.js";
import { startVectorCleanupWorker } from "./workers/vectorCleanup.worker.js";
import { apiRateLimiter } from "./middleware/rateLimiter.js";

/* =========================================================
   ENV TESTS
========================================================= */
console.log("ENV PATH TEST");
console.log("FLW_SECRET_KEY:", process.env.FLW_SECRET_KEY);
console.log("DOTENV TEST:", {
   GEMINI: !!process.env.GEMINI_API_KEY,
   MONGO: !!process.env.MONGODB_URI,
});

/* =========================================================
   CORE PACKAGES
========================================================= */
import express from "express";
import cookieParser from "cookie-parser";
import passport from "passport";
import session from "express-session";
import cors from "cors";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import {
   decryptRequest,
   encryptResponse,
} from "./middleware/encryption.js";

/* =========================================================
   ROUTES
========================================================= */
import subscriptionRoutes from "./routes/subscription.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import askRoutes from "./routes/ask.js";
import voiceRoutes from "./routes/voice.js";
import ingestRoutes from "./routes/ingest.js";
import referralRouter from "./routes/referral.routes.js";
import violationRoutes from "./routes/violation.route.js";
import authRoutes from "./routes/auth.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import walletRouter from "./routes/wallet.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";

/* =========================================================
   SWAGGER
========================================================= */
import { swaggerUi, specs } from "./docs/swagger.js";

/* =========================================================
   PASSPORT CONFIG
========================================================= */
import "./config/passport.js";

/* =========================================================
   STARTUP LOGS
========================================================= */
console.log("=========================================");
console.log("🚀 Starting Legal RAG Backend");
console.log("=========================================");
console.log("Environment Loaded:", {
   NODE_ENV: process.env.NODE_ENV,
   PORT: process.env.PORT,
   MONGODB_URI_EXISTS: !!process.env.MONGODB_URI,
   GEMINI_API_KEY_EXISTS: !!process.env.GEMINI_API_KEY,
   SESSION_SECRET_EXISTS: !!process.env.SESSION_SECRET,
});

/* =========================================================
   START SERVER
========================================================= */
async function startServer() {
   try {
      /* =====================================================
         MONGODB
      ===================================================== */
      console.log("📦 Connecting to MongoDB...");
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("✅ MongoDB connected");

      /* =====================================================
         QDRANT INIT
      ===================================================== */
      console.log("📦 Initializing Qdrant collections...");
      await initializeQdrantCollections();
      startVectorCleanupWorker();
      console.log("✅ Qdrant initialized");

      /* =====================================================
         EXPRESS APP
      ===================================================== */
      const app = express();
      console.log("⚙️ Express application initialized");

      /* =====================================================
         TRUST PROXY
      ===================================================== */
      app.set("trust proxy", 1);

      /* =====================================================
         CORS
      ===================================================== */
      const corsOptions = {
         origin:
            process.env.NODE_ENV === "production"
               ? process.env.CLIENT_URL_PROD
               : process.env.CLIENT_URL_TEST,
         methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
         credentials: true,
      };

      console.log("🌍 CORS configured", { origin: corsOptions.origin });
      app.use(cors(corsOptions));
      app.use(
         "/payments/webhook",
         express.raw({ type: "application/json" }),
         (req, res, next) => {
            if (Buffer.isBuffer(req.body)) {
               req.body = JSON.parse(req.body.toString());
            }
            next();
         }
      );
      /* =====================================================
         BODY + COOKIE PARSERS
      ===================================================== */
      app.use(express.json({ limit: "50mb" }));
      app.use(express.urlencoded({ extended: true, limit: "10mb" }));
      app.use(cookieParser());
      console.log("✅ Body and cookie parsers configured");

      /* =====================================================
         GLOBAL RATE LIMITING
      ===================================================== */
      app.use(apiRateLimiter);
      console.log("✅ Global API rate limiting enabled");

      /* =====================================================
         SESSION CONFIG
      ===================================================== */
      console.log("🛡️ Configuring session middleware...");
      app.use(
         session({
            secret: process.env.SESSION_SECRET || "supersecret",
            resave: false,
            saveUninitialized: false,
            proxy: process.env.NODE_ENV === "production",
            store: MongoStore.create({
               mongoUrl: process.env.MONGODB_URI,
               collectionName: "sessions",
               ttl: 24 * 60 * 60,
            }),
            cookie: {
               secure: process.env.NODE_ENV === "production",
               httpOnly: true,
               sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
               maxAge: 24 * 60 * 60 * 1000,
            },
         })
      );
      console.log("✅ Session middleware configured");

      /* =====================================================
         PASSPORT
      ===================================================== */
      app.use(passport.initialize());
      app.use(passport.session());
      console.log("✅ Passport middleware initialized");

      /* =====================================================
         AUTH ROUTES
         Mounted BEFORE the encryption middleware below —
         the frontend talks to /auth/* with plain fetch()
         (no encryptedFetch), so these responses must stay
         unencrypted JSON.
      ===================================================== */
      app.use("/auth", authRoutes);
      console.log("✅ Auth routes registered (unencrypted)");

      /* =====================================================
         ENCRYPTION MIDDLEWARE
         decryptRequest  — unwraps encrypted request bodies
         encryptResponse — wraps JSON responses in AES-GCM
         Both are no-ops when ENCRYPTION_SECRET is not set,
         so safe to deploy before the env var is configured.
         Mounted AFTER /auth — the frontend's auth calls use
         plain fetch() and must get back plain JSON.
      ===================================================== */
      app.use(decryptRequest);
      app.use(encryptResponse);
      console.log("✅ Encryption middleware configured");

      /* =====================================================
         HEALTH CHECK
      ===================================================== */
      app.get("/health", async (req, res) => {
         try {
            const mongoState = mongoose.connection.readyState;
            return res.json({
               status: "healthy",
               uptime: process.uptime(),
               timestamp: new Date().toISOString(),
               services: {
                  mongodb: mongoState === 1 ? "connected" : "disconnected",
                  qdrant: "connected",
               },
            });
         } catch (err) {
            return res.status(500).json({ status: "unhealthy", error: err?.message });
         }
      });
      console.log("✅ Health check route enabled");

      /* =====================================================
         ROOT ROUTE
      ===================================================== */
      app.get("/", (req, res) => {
         res.send("🌍 Legal RAG backend running.");
      });

      /* =====================================================
         API ROUTES
      ===================================================== */
      console.log("🛣️ Registering routes...");

      app.use("/ask", askRoutes);
      app.use("/ask", voiceRoutes);
      app.use("/ask", ingestRoutes);
      app.use("/admin", adminRoutes);
      app.use("/report", violationRoutes);
      app.use("/api/referral", referralRouter);
      app.use("/conversations", conversationRoutes);
      app.use("/subscription", subscriptionRoutes);
      app.use("/api/wallet", walletRouter);
      app.use("/payments", paymentRoutes);

      console.log("✅ API routes registered");

      /* =====================================================
         SWAGGER DOCS
      ===================================================== */
      app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
      console.log("✅ Swagger documentation enabled");

      /* =====================================================
         GLOBAL ERROR HANDLER
      ===================================================== */
      app.use((err, req, res, next) => {
         console.error("❌ GLOBAL ERROR:", {
            message: err?.message,
            stack: err?.stack,
         });
         return res.status(500).json({ error: "Internal server error" });
      });

      /* =====================================================
         START SERVER
      ===================================================== */
      const PORT = process.env.PORT || 5000;
      app.listen(PORT, () => {
         console.log("=========================================");
         console.log(`✅ Server listening on port ${PORT}`);
         console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
         console.log("=========================================");
      });

   } catch (err) {
      console.error("❌ Failed to start server:", {
         message: err?.message,
         stack: err?.stack,
      });
      process.exit(1);
   }
}

startServer();