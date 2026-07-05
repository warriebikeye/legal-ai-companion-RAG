// src/controllers/wallet.controller.js
import crypto from "crypto";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";

/* ─── GET /api/wallet/balance ─── */
export async function getWalletBalance(req, res) {
  try {
    const user = await User.findById(req.user._id)
      .select("wallet dailyFreeTokens referralCode referralCount");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    /* ── Auto-heal missing referral code ──────────────────
       Existing users who registered before Phase 4 won't
       have a referralCode. Generate one on the fly and
       save it so they never see the missing button again.
    ───────────────────────────────────────────────────── */
    if (!user.referralCode) {
      let code;
      let exists = true;

      // Keep generating until we find a unique code
      while (exists) {
        code   = crypto.randomBytes(4).toString("hex").toUpperCase();
        exists = await User.exists({ referralCode: code });
      }

      user.referralCode = code;
      await user.save();

      console.log(`[wallet] Generated missing referralCode for user: ${user._id} → ${code}`);
    }

    return res.json({
      success:         true,
      wallet:          user.wallet,
      dailyFreeTokens: user.dailyFreeTokens,
      referralCode:    user.referralCode,
      referralCount:   user.referralCount,
    });
  } catch (err) {
    console.error("[getWalletBalance]", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch wallet" });
  }
}

/* ─── GET /api/wallet/transactions ─── */
export async function getTransactionHistory(req, res) {
  try {
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip  = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("type tokens action usdAmount bundleId flwReference status expiresAt createdAt"),
      Transaction.countDocuments({ user: req.user._id }),
    ]);

    return res.json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[getTransactionHistory]", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch transactions" });
  }
}