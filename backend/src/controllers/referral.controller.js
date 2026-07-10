// src/controllers/referral.controller.js
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import { sendReferralInviteEmail } from "../utils/mailer.js";
import { buildReferralNudgeInApp } from "../utils/onesignal.js";
import { REFERRAL_REWARD } from "../config/tokens.js";

/* =========================================================
   GET /api/referral/info
   Returns referral code, link, count, total tokens earned
========================================================= */
export async function getReferralInfo(req, res) {
  try {
    const user = await User.findById(req.user._id)
      .select("referralCode referralCount wallet name");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const baseUrl      = process.env.CLIENT_URL_PROD || process.env.CLIENT_URL_TEST;
    const referralLink = `${baseUrl}/signup?ref=${user.referralCode}`;

    // Total tokens earned from referrals
    const referralTxs = await Transaction.find({
      user:   user._id,
      action: "referral_reward",
      type:   "credit",
    }).select("tokens");

    const totalEarned = referralTxs.reduce((sum, t) => sum + t.tokens, 0);

    return res.json({
      success:           true,
      referralCode:      user.referralCode,
      referralLink,
      referralCount:     user.referralCount,
      totalEarned,
      rewardPerReferral: 75,
    });
  } catch (err) {
    console.error("[getReferralInfo]", err.message);
    return res.status(500).json({ success: false, message: "Failed to fetch referral info" });
  }
}

/* =========================================================
   POST /api/referral/invite
   Sends referral invite email to a friend
   Body: { friendEmail }
========================================================= */
export async function sendReferralInvite(req, res) {
  try {
    const { friendEmail } = req.body;

    if (!friendEmail) {
      return res.status(400).json({ success: false, message: "friendEmail is required" });
    }

    // Can't invite yourself
    if (friendEmail.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: "You cannot invite yourself" });
    }

    // Already a verified user
    const existing = await User.findOne({
      email:      friendEmail.toLowerCase(),
      isVerified: true,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "This email is already a Clauzify user",
      });
    }

    const user = await User.findById(req.user._id)
      .select("referralCode name");

    const baseUrl      = process.env.CLIENT_URL_PROD || process.env.CLIENT_URL_TEST;
    const referralLink = `${baseUrl}/signup?ref=${user.referralCode}`;

    await sendReferralInviteEmail(friendEmail, user.name, referralLink);

    return res.json({ success: true, message: `Invite sent to ${friendEmail}` });

  } catch (err) {
    console.error("[sendReferralInvite]", err.message);
    return res.status(500).json({ success: false, message: "Failed to send invite" });
  }
}

const REFERRAL_NUDGE_DAILY_LIMIT = 3;

/* =========================================================
   GET /api/referral/nudge
   Called by the frontend on page load. If the current user
   has no tokens left (wallet + daily free both exhausted),
   returns an in-app notification nudging them to refer a
   friend for free tokens. No push — the app is already open.
   Capped at REFERRAL_NUDGE_DAILY_LIMIT shows per calendar day.
========================================================= */
export async function getReferralNudge(req, res) {
  console.log(`[ReferralNudge] ── GET /api/referral/nudge ──────────────────`);
  console.log(`[ReferralNudge] userId          : ${req.user._id}`);
  console.log(`[ReferralNudge] email           : ${req.user.email}`);
  try {
    // req.user is already fully hydrated from the DB by requireAuth
    // (passport deserializeUser / JWT fallback), so no extra lookup needed.
    console.log(`[ReferralNudge] wallet          : ${req.user.wallet}`);
    console.log(`[ReferralNudge] dailyFreeTokens : ${req.user.dailyFreeTokens}`);

    const hasNoTokens = req.user.wallet <= 0 && req.user.dailyFreeTokens <= 0;
    console.log(`[ReferralNudge] hasNoTokens     : ${hasNoTokens}`);

    if (!hasNoTokens) {
      console.log(`[ReferralNudge] → user still has tokens, not showing. show=false`);
      return res.json({ success: true, show: false });
    }

    // Reset the counter on a new calendar day, same convention as the
    // daily free token reset in tokenGate.js.
    const now       = new Date();
    const lastShown = req.user.lastReferralNudgeAt;
    const isNewDay  = !lastShown || now.toDateString() !== new Date(lastShown).toDateString();
    const todaysCount = isNewDay ? 0 : (req.user.referralNudgeCount || 0);

    console.log(`[ReferralNudge] lastShownAt     : ${lastShown ?? "never"}`);
    console.log(`[ReferralNudge] isNewDay        : ${isNewDay}`);
    console.log(`[ReferralNudge] todaysCount     : ${todaysCount} / ${REFERRAL_NUDGE_DAILY_LIMIT}`);

    if (todaysCount >= REFERRAL_NUDGE_DAILY_LIMIT) {
      console.log(`[ReferralNudge] → daily limit reached, not showing. show=false`);
      return res.json({ success: true, show: false });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $set: { lastReferralNudgeAt: now, referralNudgeCount: todaysCount + 1 } }
    );
    console.log(`[ReferralNudge] → counter updated to ${todaysCount + 1}, building in-app notification`);

    const notification = buildReferralNudgeInApp(REFERRAL_REWARD);
    console.log(`[ReferralNudge] notification    :`, JSON.stringify(notification));
    console.log(`[ReferralNudge] → show=true, sending response`);

    return res.json({
      success:      true,
      show:         true,
      notification,
    });
  } catch (err) {
    console.error("[ReferralNudge] ❌ error:", err.message, err.stack);
    return res.status(500).json({ success: false, message: "Failed to check referral nudge" });
  }
}