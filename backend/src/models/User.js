import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      index: true,
    },
    // Add to your existing User schema
    password: { type: String },           // hashed, optional (Google users won't have it)
    isVerified: { type: Boolean, default: false },
    verifyToken: { type: String },
    verifyTokenExpiry: { type: Date },
    name: {
      type: String,
      default: "",
    },

    photo: {
      type: String,
      default: "",
    },

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
       Subscription
    ========================================= */

    subscriptionTier: {
      type: String,
      enum: [
        "free",
        "premium",
        "enterprise",
      ],
      default: "free",
      index: true,
    },

    subscriptionStatus: {
      type: String,
      enum: [
        "inactive",
        "active",
        "expired",
        "cancelled",
      ],
      default: "inactive",
    },

    subscriptionPlan: {
      type: String,
      enum: [
        "daily",
        "weekly",
        "monthly",
        "yearly",
        null,
      ],
      default: null,
    },

    subscriptionStartDate: {
      type: Date,
      default: null,
    },

    subscriptionEndDate: {
      type: Date,
      default: null,
      index: true,
    },

    /* =========================================
       Usage Tracking
    ========================================= */

    dailyRequestCount: {
      type: Number,
      default: 0,
    },

    lastRequestDate: {
      type: Date,
      default: null,
    },

    lastActiveAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "User",
  UserSchema
);