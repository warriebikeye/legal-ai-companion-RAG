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