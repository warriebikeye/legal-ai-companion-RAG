// src/models/Transaction.js
import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Set on "referral_reward" transactions — the referee whose signup
    // earned the referrer this reward. Used for idempotency (one reward
    // per referred user), since the referee itself is no longer credited.
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    tokens: {
      type: Number,
      required: true,
    },
    action: {
      type: String,
      enum: [
        "topup",
        "referral_reward",
        "question",
        "review",
        "referral_connection",
      ],
      required: true,
    },
    // Topup metadata
    usdAmount:    { type: Number, default: null },
    bundleId:     { type: String, default: null },
    flwReference: { type: String, default: null, index: true, unique: true, sparse: true },
    // Expiry — set on every credit
    expiresAt: { type: Date, default: null, index: true },
    // Expiry warning sent
    warned: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ["success", "failed", "pending", "expired"],
      default: "success",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Transaction", TransactionSchema);