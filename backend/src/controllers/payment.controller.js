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
    const flwResponse = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        },
      }
    );

    const payment = flwResponse.data?.data;

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

    /* ─── Credit wallet ─── */
    user.wallet += bundle.tokens;
    await user.save();

    /* ─── Log credit transaction ─── */
    await Transaction.create({
      user:         user._id,
      type:         "credit",
      tokens:       bundle.tokens,
      action:       "topup",
      bundleId:     bundle.id,
      flwReference: String(transactionId),
      expiresAt:    addDays(new Date(), TOKEN_EXPIRY_DAYS),
      status:       "success",
    });

    console.log("[verifyPayment] Wallet credited:", {
      userId:  user._id,
      bundle:  bundle.id,
      tokens:  bundle.tokens,
      balance: user.wallet,
    });

    return res.json({
      success: true,
      message: "Wallet topped up successfully",
      bundle:  bundle.label,
      tokens:  bundle.tokens,
      wallet:  user.wallet,
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

    /* ─── Extract bundleId from tx_ref ───────────────────
       tx_ref format from Flutterwave redirect URL will be
       whatever FLW generates. We extract bundleId from the
       redirect URL meta that FLW sends in the webhook body.
       FLW includes the redirect_url in webhook payload so
       we parse bundle= from it.
    ───────────────────────────────────────────────────── */
    let bundleId = null;

    try {
      const redirectUrl = payment?.meta?.redirect || payment?.redirect_url || "";
      const urlParams   = new URL(redirectUrl).searchParams;
      bundleId          = urlParams.get("bundle");
    } catch {
      // redirect_url not parseable — try meta directly
      bundleId = payment?.meta?.bundleId || null;
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

    /* ─── Credit wallet ─── */
    user.wallet += bundle.tokens;
    await user.save();

    /* ─── Log transaction ─── */
    await Transaction.create({
      user:         user._id,
      type:         "credit",
      tokens:       bundle.tokens,
      action:       "topup",
      bundleId:     bundle.id,
      flwReference: String(payment.id),
      expiresAt:    addDays(new Date(), TOKEN_EXPIRY_DAYS),
      status:       "success",
    });

    console.log("[webhook] Wallet credited:", {
      userId: user._id,
      bundle: bundle.id,
      tokens: bundle.tokens,
    });

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("[webhook] Error:", err.message);
    return res.status(200).json({ received: true });
  }
}