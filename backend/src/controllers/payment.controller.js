// src/controllers/payment.controller.js
import axios from "axios";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import { BUNDLES, TOKEN_EXPIRY_DAYS } from "../config/tokens.js";

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/* =========================================================
   Verify a transaction with Flutterwave, retrying transient
   failures (network errors, 429, 5xx) with exponential
   backoff. Non-retryable errors (4xx besides 429, e.g. an
   invalid transaction id) fail immediately.
========================================================= */
async function verifyWithFlutterwave(transactionId, retries = 3, delayMs = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const flwResponse = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        {
          headers: {
            Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          },
        }
      );
      return flwResponse.data?.data;
    } catch (err) {
      const status      = err.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;

      if (!isRetryable || attempt === retries) {
        throw err;
      }

      console.warn(
        `[verifyPayment] FLW verify attempt ${attempt}/${retries} failed (${status || err.message}) — retrying in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

/* =========================================================
   POST /payments/verify
   Body: { transactionId, txRef, bundleId }
========================================================= */
export async function verifyPayment(req, res) {
  console.log("\n[verifyPayment] Started:", new Date().toISOString());

  try {
    const { transactionId, txRef, bundleId } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "transactionId is required",
      });
    }

    if (!bundleId) {
      return res.status(400).json({
        success: false,
        message: "bundleId is required",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    /* ─── Find bundle by ID — no amount matching needed ─── */
    const bundle = BUNDLES.find((b) => b.id === bundleId);

    if (!bundle) {
      return res.status(400).json({
        success: false,
        message: `Invalid bundle: ${bundleId}`,
      });
    }

    console.log("[verifyPayment] Bundle identified:", bundle.id, "→", bundle.tokens, "tokens");

    /* ─── Duplicate check — prevent double crediting ─── */
    const existing = await Transaction.findOne({
      flwReference: String(transactionId),
    });

    if (existing) {
      console.warn("[verifyPayment] Duplicate transaction:", transactionId);
      return res.status(409).json({
        success: false,
        message: "Transaction already processed",
      });
    }

    /* ─── Verify with Flutterwave — confirm payment succeeded ─── */
    console.log("[verifyPayment] Calling FLW API...");
    const payment = await verifyWithFlutterwave(transactionId);

    console.log("[verifyPayment] FLW response:", {
      status:   payment?.status,
      amount:   payment?.amount,
      currency: payment?.currency,
    });

    if (!payment || payment.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful",
      });
    }

    /* ─── Fetch user ─── */
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    /* ─── Log credit transaction FIRST — this is the concurrency
       gate. flwReference has a unique index, so if /verify and
       /webhook (or a duplicate call) race each other, only one
       insert can win; the loser hits the catch block below and
       never touches the wallet. ─── */
    try {
      await Transaction.create({
        user:         user._id,
        type:         "credit",
        tokens:       bundle.tokens,
        action:       "topup",
        usdAmount:    bundle.usdEquiv,
        bundleId:     bundle.id,
        flwReference: String(transactionId),
        expiresAt:    addDays(new Date(), TOKEN_EXPIRY_DAYS),
        status:       "success",
      });
    } catch (err) {
      if (err.code === 11000) {
        console.warn("[verifyPayment] Duplicate transaction (race):", transactionId);
        return res.status(409).json({
          success: false,
          message: "Transaction already processed",
        });
      }
      throw err;
    }

    /* ─── Credit wallet atomically — no read-modify-write ─── */
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { wallet: bundle.tokens } },
      { new: true }
    );

    console.log("[verifyPayment] Wallet credited:", {
      userId:  user._id,
      bundle:  bundle.id,
      tokens:  bundle.tokens,
      balance: updatedUser.wallet,
    });

    return res.json({
      success: true,
      message: "Wallet topped up successfully",
      bundle:  bundle.label,
      tokens:  bundle.tokens,
      wallet:  updatedUser.wallet,
    });

  } catch (err) {
    console.error("[verifyPayment] Error:", err.message, err.response?.data);
    return res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
}

/* =========================================================
   POST /payments/webhook
   Backup — credits wallet if redirect was missed
   Uses tx_ref to look up bundleId from existing
   pending logic — webhook gets bundleId from meta
========================================================= */
export async function flutterwaveWebhook(req, res) {
  try {
    /* ─── Verify webhook signature ─── */
    const hash = req.headers["verif-hash"];
    if (!hash || hash !== process.env.FLW_WEBHOOK_HASH) {
      console.warn("[webhook] Invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event   = req.body;
    const payment = event.data;

    console.log("[webhook] Event:", event.event, payment?.id);

    if (
      event.event !== "charge.completed" ||
      payment?.status !== "successful"
    ) {
      return res.status(200).json({ received: true });
    }

    /* ─── Duplicate check ─── */
    const existing = await Transaction.findOne({
      flwReference: String(payment.id),
    });

    if (existing) {
      console.log("[webhook] Already processed:", payment.id);
      return res.status(200).json({ received: true });
    }

    /* ─── Extract bundleId ────────────────────────────────
       Flutterwave Inline sends bundleId directly in `meta`
       on every transaction. Fall back to parsing it out of
       the old Payment Links redirect URL for any in-flight
       transactions started before the switch to Inline.
    ───────────────────────────────────────────────────── */
    let bundleId = payment?.meta?.bundleId || null;

    if (!bundleId) {
      try {
        const redirectUrl = payment?.meta?.redirect || payment?.redirect_url || "";
        const urlParams   = new URL(redirectUrl).searchParams;
        bundleId          = urlParams.get("bundle");
      } catch {
        bundleId = null;
      }
    }

    if (!bundleId) {
      console.error("[webhook] Could not extract bundleId from payment meta");
      return res.status(200).json({ received: true });
    }

    const bundle = BUNDLES.find((b) => b.id === bundleId);
    if (!bundle) {
      console.error("[webhook] Invalid bundleId:", bundleId);
      return res.status(200).json({ received: true });
    }

    /* ─── Find user by email ─── */
    const user = await User.findOne({ email: payment.customer?.email });
    if (!user) {
      console.error("[webhook] User not found:", payment.customer?.email);
      return res.status(200).json({ received: true });
    }

    /* ─── Log transaction FIRST — same concurrency gate as
       /verify. If /verify already inserted this flwReference
       (race with the browser callback), this insert hits the
       unique-index conflict and we no-op instead of double
       crediting. ─── */
    try {
      await Transaction.create({
        user:         user._id,
        type:         "credit",
        tokens:       bundle.tokens,
        action:       "topup",
        usdAmount:    bundle.usdEquiv,
        bundleId:     bundle.id,
        flwReference: String(payment.id),
        expiresAt:    addDays(new Date(), TOKEN_EXPIRY_DAYS),
        status:       "success",
      });
    } catch (err) {
      if (err.code === 11000) {
        console.log("[webhook] Already processed (race with /verify):", payment.id);
        return res.status(200).json({ received: true });
      }
      throw err;
    }

    /* ─── Credit wallet atomically ─── */
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { wallet: bundle.tokens } },
      { new: true }
    );

    console.log("[webhook] Wallet credited:", {
      userId:  user._id,
      bundle:  bundle.id,
      tokens:  bundle.tokens,
      balance: updatedUser.wallet,
    });

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("[webhook] Error:", err.message);
    return res.status(200).json({ received: true });
  }
}