import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

console.log("ENV PATH TEST");
console.log(
  "FLW_SECRET_KEY:",
  process.env.FLW_SECRET_KEY
);
console.log("DOTENV TEST:", {
  GEMINI: !!process.env.GEMINI_API_KEY,
  MONGO: !!process.env.MONGODB_URI
});
/* =========================================================
   Core Packages
========================================================= */
import express from "express";
import passport from "passport";
import session from "express-session";
import cors from "cors";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import subscriptionRoutes from "./routes/subscription.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
/* =========================================================
   Swagger
========================================================= */
import { swaggerUi, specs } from "./docs/swagger.js";

/* =========================================================
   Routes
========================================================= */
import askRoutes from "./routes/ask.js";
import voiceRoutes from "./routes/voice.js";
import ingestRoutes from "./routes/ingest.js";
import violationRoutes from "./routes/violation.route.js";
import authRoutes from "./routes/auth.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";

/* =========================================================
   Passport Config
========================================================= */
import "./config/passport.js";

/* =========================================================
   Startup Logs
========================================================= */
console.log("=========================================");
console.log("🚀 Starting Legal RAG Backend");
console.log("=========================================");

console.log("Environment Loaded:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGODB_URI_EXISTS: !!process.env.MONGODB_URI,
  GEMINI_API_KEY_EXISTS:
    !!process.env.GEMINI_API_KEY,
  SESSION_SECRET_EXISTS:
    !!process.env.SESSION_SECRET,
});

async function startServer() {
  try {
    /* =========================================================
       MongoDB Connection
    ========================================================= */

    console.log(
      "📦 Connecting to MongoDB..."
    );

    await mongoose.connect(
      process.env.MONGODB_URI
    );

    console.log("✅ MongoDB connected");

    /* =========================================================
       Express App
    ========================================================= */

    const app = express();

    console.log(
      "⚙️ Express application initialized"
    );

    /* =========================================================
       CORS Configuration
    ========================================================= */

    const corsOptions = {
      origin:
        process.env.NODE_ENV ===
          "production"
          ? process.env.CLIENT_URL_PROD
          : process.env.CLIENT_URL_TEST,

      methods: ["GET", "POST"],

      credentials: true,
    };

    console.log("🌍 CORS configured", {
      origin: corsOptions.origin,
    });

    app.use(cors(corsOptions));

    /* =========================================================
       JSON Middleware
    ========================================================= */

    app.use(express.json());

    app.set("trust proxy", 1);

    console.log(
      "✅ JSON middleware configured"
    );

    /* =========================================================
       Session Configuration
    ========================================================= */

    console.log(
      "🛡️ Configuring session middleware..."
    );

    app.use(
      session({
        secret:
          process.env.SESSION_SECRET ||
          "supersecret",

        resave: false,

        saveUninitialized: false,

        store: MongoStore.create({
          mongoUrl:
            process.env.MONGODB_URI,

          collectionName: "sessions",

          ttl: 24 * 60 * 60,
        }),

        cookie: {
          secure:
            process.env.NODE_ENV ===
            "production",

          httpOnly: true,

          sameSite:
            process.env.NODE_ENV ===
              "production"
              ? "none"
              : "lax",

          maxAge:
            24 * 60 * 60 * 1000,
        },
      })
    );

    console.log(
      "✅ Session middleware configured"
    );

    /* =========================================================
       Passport Middleware
    ========================================================= */

    app.use(passport.initialize());

    app.use(passport.session());

    console.log(
      "✅ Passport middleware initialized"
    );

    /* =========================================================
       API Routes
    ========================================================= */

    console.log("🛣️ Registering routes...");

    app.use("/auth", authRoutes);

    app.use("/ask", askRoutes);

    app.use("/ask", voiceRoutes);

    app.use("/ask", ingestRoutes);

    app.use("/report", violationRoutes);

    app.use("/", conversationRoutes);

    app.use("/subscription", subscriptionRoutes);
    app.use("/payments", paymentRoutes);

    console.log(
      "✅ API routes registered"
    );

    /* =========================================================
       Swagger Docs
    ========================================================= */

    app.use(
      "/api-docs",
      swaggerUi.serve,
      swaggerUi.setup(specs)
    );

    console.log(
      "✅ Swagger documentation enabled"
    );

    /* =========================================================
       Root Route
    ========================================================= */

    app.get("/", (req, res) => {
      res.send(
        "🌍 Legal RAG backend running."
      );
    });

    /* =========================================================
       Start Server
    ========================================================= */

    const PORT =
      process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(
        "========================================="
      );

      console.log(
        `✅ Server listening on port ${PORT}`
      );

      console.log(
        `🌍 Environment: ${process.env.NODE_ENV ||
        "development"
        }`
      );

      console.log(
        "========================================="
      );
    });
  } catch (err) {
    console.error(
      "❌ Failed to start server:",
      {
        message: err?.message,
        stack: err?.stack,
      }
    );

    process.exit(1);
  }
}

startServer();