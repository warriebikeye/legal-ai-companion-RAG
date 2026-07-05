// src/middleware/tokenGate.js
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import { COSTS, FREE_DAILY_TOKENS } from "../config/tokens.js";

/**
 * tokenGate(action | 'auto')
 *
 * 'auto' — detects Q&A vs review from req.files
 * Named function (not arrow) — prevents Express losing `next`
 * Uses req.originalUrl for stream detection — reliable across routers
 */
const tokenGate = (action = "auto") => {
  return async function tokenGateMiddleware(req, res, next) {

    if (typeof next !== "function") {
      console.error("[tokenGate] FATAL: next is not a function");
      return res.status(500).json({ error: "Middleware configuration error" });
    }

    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      /* ── Resolve action ── */
      let resolvedAction = action;
      if (action === "auto") {
        const hasFiles =
          (Array.isArray(req.files) && req.files.length > 0) ||
          (req.body?.hasFiles === "true");
        resolvedAction = hasFiles ? "review" : "question";
      }

      const cost = COSTS[resolvedAction];
      if (cost === undefined) {
        return res.status(500).json({ error: `Unknown action: ${resolvedAction}` });
      }

      /* ── Detect SSE stream route ── */
      const isStream = req.originalUrl?.includes("stream") ?? false;

      /* ── Free daily token path (Q&A only) ── */
      if (resolvedAction === "question") {
        const now       = new Date();
        const lastReset = new Date(user.lastFreeReset);
        const isNewDay  = now.toDateString() !== lastReset.toDateString();

        if (isNewDay) {
          user.dailyFreeTokens = FREE_DAILY_TOKENS;
          user.lastFreeReset   = now;
          await user.save();
        }

        if (user.dailyFreeTokens > 0) {
          user.dailyFreeTokens -= 1;
          await user.save();
          req.usedFreeToken = true;
          req.tokenCost     = 0;
          req.tokenAction   = resolvedAction;
          return next();
        }
      }

      /* ── Wallet balance check ── */
      if (user.wallet < cost) {
        if (isStream) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.flushHeaders();
          res.write(
            `data: ${JSON.stringify({
              type:     "error",
              payload:  "insufficient_tokens",
              required: cost,
              current:  user.wallet,
            })}\n\n`
          );
          return res.end();
        }
        return res.status(402).json({
          error:    "insufficient_tokens",
          message:  "Not enough tokens. Please top up your wallet.",
          required: cost,
          current:  user.wallet,
        });
      }

      /* ── Deduct tokens ── */
      user.wallet -= cost;
      await user.save();

      /* ── Log debit ── */
      await Transaction.create({
        user:   user._id,
        type:   "debit",
        tokens: cost,
        action: resolvedAction,
        status: "success",
      });

      req.usedFreeToken = false;
      req.tokenCost     = cost;
      req.tokenAction   = resolvedAction;
      return next();

    } catch (err) {
      console.error("[tokenGate] Error:", err.message);
      const isStream = req.originalUrl?.includes("stream") ?? false;
      if (isStream) {
        try {
          res.setHeader("Content-Type", "text/event-stream");
          res.flushHeaders();
          res.write(`data: ${JSON.stringify({ type: "error", payload: "Token gate failed" })}\n\n`);
          return res.end();
        } catch { /* already written */ }
      }
      return res.status(500).json({ error: "Token gate failed" });
    }
  };
};

export default tokenGate;