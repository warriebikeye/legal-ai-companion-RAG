// src/models/User.js
import mongoose from "mongoose";
import crypto from "crypto";

const UserSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: false,
      unique: false,
      index: true,
      sparse: true,
    },
    email: {
      type: String,
      required: true,
      index: true,
    },
    password: { type: String },
    isVerified: { type: Boolean, default: false },
    verifyToken: { type: String },
    verifyTokenExpiry: { type: Date },
    name: { type: String, default: "" },
    photo: { type: String, default: "" },

    /* =========================================
       Role
    ========================================= */
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },

    /* =========================================
       Subscription — kept intact for backwards
       compatibility during transition
    ========================================= */
    subscriptionTier: {
      type: String,
      enum: ["free", "premium", "enterprise"],
      default: "free",
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ["inactive", "active", "expired", "cancelled"],
      default: "inactive",
    },
    subscriptionPlan: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly", null],
      default: null,
    },
    subscriptionStartDate: { type: Date, default: null },
    subscriptionEndDate:   { type: Date, default: null, index: true },

    /* =========================================
       Usage Tracking
    ========================================= */
    dailyRequestCount: { type: Number, default: 0 },
    lastRequestDate:   { type: Date, default: null },
    lastActiveAt:      { type: Date, default: null, index: true },

    /* =========================================
       Token Wallet — Phase 1
    ========================================= */
    wallet: {
      type: Number,
      default: 0,
    },
    dailyFreeTokens: {
      type: Number,
      default: 4,
    },
    lastFreeReset: {
      type: Date,
      default: Date.now,
    },

    /* =========================================
       Referral — Phase 4 (fields added now,
       logic comes later)
    ========================================= */
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    referralCount: {
      type: Number,
      default: 0,
    },
    lastReferralNudgeAt: {
      type: Date,
      default: null,
    },
    referralNudgeCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

/* =========================================
   Auto-generate referral code on first save
========================================= */
UserSchema.pre("save", function (next) {
  if (!this.referralCode) {
    this.referralCode = crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();
  }
  
});

export default mongoose.model("User", UserSchema);
