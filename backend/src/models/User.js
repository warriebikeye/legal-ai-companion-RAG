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

    name: {
      type: String,
      default: "",
    },

    photo: {
      type: String,
      default: "",
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
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "User",
  UserSchema
);