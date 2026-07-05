// src/controllers/wallet.controller.js
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