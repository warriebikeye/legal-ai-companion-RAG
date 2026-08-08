import rateLimit from "express-rate-limit";

import {
  PERFORMANCE_CONFIG,
} from "../config/performance.config.js";

/* =========================================================
   GLOBAL API RATE LIMITER
========================================================= */

export const apiRateLimiter =
  rateLimit({
    windowMs:
      PERFORMANCE_CONFIG.API_RATE_LIMIT_WINDOW_MS,

    max:
      PERFORMANCE_CONFIG.API_RATE_LIMIT_MAX,

    standardHeaders: true,

    legacyHeaders: false,

    // Flutterwave's webhook calls from their own infrastructure,
    // not a per-user IP — it gets its own dedicated limiter
    // (see webhookRateLimiter below) instead of sharing this
    // per-user budget.
    skip: (req) => req.originalUrl.startsWith("/payments/webhook"),

    //trustProxy: true,

    message: {
      error:
        "Too many requests. Please slow down.",

      retryAfter:
        Math.floor(
          PERFORMANCE_CONFIG
            .API_RATE_LIMIT_WINDOW_MS /
            1000
        ),
    },

    handler: (
      req,
      res,
      next,
      options
    ) => {
      console.error(
        "❌ RATE LIMIT EXCEEDED",
        {
          ip: req.ip,

          path:
            req.originalUrl,

          method:
            req.method,
        }
      );

      res.status(options.statusCode).json(
        options.message
      );
    },
  });
  // Add these to your existing rateLimiter.js, below apiRateLimiter

/* =========================================================
   AUTH RATE LIMITER
   Strict — covers register, verify, login
   Prevents brute force + crash under signup load
========================================================= */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed/repeated attempts count
  message: {
    error: "Too many attempts. Please try again in 15 minutes.",
    retryAfter: 900,
  },
  handler: (req, res, next, options) => {
    console.error("❌ AUTH RATE LIMIT EXCEEDED", {
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(options.statusCode).json(options.message);
  },
});

/* =========================================================
   /auth/me LIMITER
   Loose — called on every page load
========================================================= */
export const meLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,                  // 60 checks per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

/* =========================================================
   WEBHOOK LIMITER
   Flutterwave calls this from their own servers, not a
   per-user IP, so it's exempted from apiRateLimiter above
   and given its own generous-but-present budget instead —
   high enough to absorb legitimate bursts, low enough to
   still guard against abuse of the (signature-verified but
   otherwise public) endpoint.
========================================================= */
export const webhookRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,                 // 300 webhook calls per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many webhook requests." },
  handler: (req, res, next, options) => {
    console.error("❌ WEBHOOK RATE LIMIT EXCEEDED", { ip: req.ip });
    res.status(options.statusCode).json(options.message);
  },
});