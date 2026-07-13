// src/cron/tokenExpiry.js
//
// Runs at 01:00 WAT every night — 1 hour after the daily reset.
// Two jobs in one pass:
//
//   JOB 1 — ENFORCE EXPIRY
//     Finds credit transactions where expiresAt <= now
//     Deducts tokens per batch from wallet (partial deduction
//     if wallet already partially spent — never goes negative)
//     Marks transaction status = "expired"
//     Logs audit debit transaction
//
//   JOB 2 — EXPIRY WARNINGS
//     Finds credit transactions expiring within 14 days
//     that haven't been warned yet
//     Sends push + email warning once per user
//     Marks warned = true to prevent repeat notifications

import cron from "node-cron";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import { EXPIRY_WARNING_DAYS } from "../config/tokens.js";
import { sendTokenExpiryWarningPush } from "../utils/onesignal.js";
import { sendTokenExpiryWarningEmail } from "../utils/mailer.js";

/* =========================================================
   JOB 1 — ENFORCE EXPIRED TOKENS
========================================================= */
async function enforceExpiredTokens() {
  const jobStart = Date.now();
  console.log("[TokenExpiry] Starting expiry enforcement...");

  const now = new Date();

  try {
    // Find all credit transactions that have expired
    // and haven't been marked expired yet
    const expiredBatches = await Transaction.find({
      type:      "credit",
      status:    "success",
      expiresAt: { $lte: now },
    }).select("user tokens expiresAt");

    console.log(`[TokenExpiry] Found ${expiredBatches.length} expired batch(es).`);

    let processedCount = 0;
    let totalDeducted  = 0;
    let skippedCount   = 0;

    for (const batch of expiredBatches) {
      try {
        const user = await User.findById(batch.user);

        if (!user) {
          // Mark expired even if user not found — prevent reprocessing
          await Transaction.findByIdAndUpdate(batch._id, { status: "expired" });
          skippedCount++;
          continue;
        }

        // Only deduct what's actually in wallet
        // Prevents wallet going negative if tokens already spent
        const deductAmount = Math.min(batch.tokens, user.wallet);

        if (deductAmount > 0) {
          user.wallet -= deductAmount;
          await user.save();
          totalDeducted += deductAmount;
        }

        // Mark original credit as expired
        await Transaction.findByIdAndUpdate(batch._id, { status: "expired" });

        // Log audit debit for accounting
        if (deductAmount > 0) {
          await Transaction.create({
            user:   user._id,
            type:   "debit",
            tokens: deductAmount,
            action: "question", // closest enum — audit entry only
            status: "success",
          });
        }

        processedCount++;
        console.log(
          `[TokenExpiry] Expired ${deductAmount} tokens for ${user.email} (batch: ${batch._id})`
        );

      } catch (batchErr) {
        console.error(`[TokenExpiry] Failed batch ${batch._id}:`, batchErr.message);
      }
    }

    const duration = Date.now() - jobStart;
    console.log(
      `[TokenExpiry] Enforcement done in ${duration}ms — ` +
      `Processed: ${processedCount}, Deducted: ${totalDeducted} tokens, Skipped: ${skippedCount}`
    );

  } catch (err) {
    console.error("[TokenExpiry] Enforcement fatal error:", err.message);
  }
}

/* =========================================================
   JOB 2 — SEND EXPIRY WARNINGS
========================================================= */
async function sendExpiryWarnings() {
  const jobStart = Date.now();
  console.log("[TokenExpiry] Starting expiry warning scan...");

  const now         = new Date();
  const warningDate = new Date(
    now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000
  );

  try {
    // Find batches expiring within warning window
    // that haven't been warned yet
    const soonExpiring = await Transaction.find({
      type:      "credit",
      status:    "success",
      expiresAt: { $gt: now, $lte: warningDate },
      warned:    { $ne: true },
    }).populate("user", "email name firstname wallet");

    console.log(
      `[TokenExpiry] Found ${soonExpiring.length} batch(es) expiring within ${EXPIRY_WARNING_DAYS} days.`
    );

    // Deduplicate — one warning per user even if multiple batches expiring
    const warnedUsers = new Set();
    let warnCount     = 0;

    for (const batch of soonExpiring) {
      try {
        const user = batch.user;

        // Mark warned regardless — prevents reprocessing
        await Transaction.findByIdAndUpdate(batch._id, { warned: true });

        if (!user || warnedUsers.has(user._id.toString())) {
          continue;
        }

        const daysLeft = Math.ceil(
          (new Date(batch.expiresAt) - now) / (1000 * 60 * 60 * 24)
        );

        // Fire push + email — both non-blocking
        sendTokenExpiryWarningPush(user.email, user.firstname || user.name, batch.tokens, daysLeft)
          .catch(() => {});

        sendTokenExpiryWarningEmail(user.email, user.firstname || user.name, batch.tokens, daysLeft)
          .catch(() => {});

        warnedUsers.add(user._id.toString());
        warnCount++;

        console.log(
          `[TokenExpiry] Warning sent to ${user.email} — ` +
          `${batch.tokens} tokens expire in ${daysLeft} day(s)`
        );

      } catch (warnErr) {
        console.error(`[TokenExpiry] Warning failed for batch ${batch._id}:`, warnErr.message);
      }
    }

    const duration = Date.now() - jobStart;
    console.log(
      `[TokenExpiry] Warning scan done in ${duration}ms — Warned: ${warnCount} user(s)`
    );

  } catch (err) {
    console.error("[TokenExpiry] Warning scan fatal error:", err.message);
  }
}

/* =========================================================
   COMBINED NIGHTLY RUN
========================================================= */
export async function runTokenExpiry() {
  console.log("[TokenExpiry] ========================================");
  console.log("[TokenExpiry] Nightly expiry job started");

  await enforceExpiredTokens();
  await sendExpiryWarnings();

  console.log("[TokenExpiry] Nightly expiry job complete");
  console.log("[TokenExpiry] ========================================");
}

/* =========================================================
   SCHEDULE — 01:00 WAT every night
   1 hour after midnight daily reset to avoid
   both crons hitting the DB simultaneously
========================================================= */
export function scheduleTokenExpiry() {
  cron.schedule("0 1 * * *", runTokenExpiry, {
    timezone: "Africa/Lagos",
  });
  console.log("[TokenExpiry] Cron scheduled — runs at 01:00 WAT nightly.");
}