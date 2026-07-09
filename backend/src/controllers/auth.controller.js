// src/controllers/auth.controller.js
import passport from "passport";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import {
  sendVerificationEmail,
  sendReferralRewardEmail,
} from "../utils/mailer.js";
import { setAuthCookie, clearAuthCookie } from "../utils/setAuthCookie.js";
import { REFERRAL_REWARD, TOKEN_EXPIRY_DAYS } from "../config/tokens.js";
import { sendDailyResetNotification, sendWelcomeNotification } from "../utils/onesignal.js";

/* ─── Helper ─── */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/* =========================================================
   REGISTER
   Accepts optional referralCode from body or ?ref= query
========================================================= */
export const register = async (req, res) => {
  const { email, password, name } = req.body;

  // Read referral code from body or query string
  const referralCode = (
    req.body.referralCode ||
    req.query.ref ||
    ""
  ).toUpperCase().trim();

  if (!email || !password || !name) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const existing = await User.findOne({ email });

    if (existing?.isVerified) {
      return res.status(409).json({ error: "Email already registered. Please log in." });
    }

    /* ── Resolve referrer ── */
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode });
      if (referrer) {
        console.log(`[register] Referral matched: ${referralCode} → ${referrer.email}`);
      } else {
        console.warn(`[register] Referral code not found: ${referralCode}`);
      }
    }

    const token = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    const hashed = await bcrypt.hash(password, 12);

    if (existing && !existing.isVerified) {
      existing.password = hashed;
      existing.name = name;
      existing.verifyToken = token;
      existing.verifyTokenExpiry = expiry;
      // Update referredBy if not already set
      if (referrer && !existing.referredBy) {
        existing.referredBy = referrer._id;
      }
      await existing.save();
    } else {
      await User.create({
        email,
        name,
        password: hashed,
        isVerified: false,
        verifyToken: token,
        verifyTokenExpiry: expiry,
        referredBy: referrer ? referrer._id : null,
      });
    }

    await sendVerificationEmail(email, token);

    return res.json({
      success: true,
      message: "Verification code sent.",
      hasReferral: !!referrer,
    });

  } catch (err) {
    console.error("[register]", err);
    return res.status(500).json({ error: "Registration failed." });
  }
};

/* =========================================================
   VERIFY EMAIL
   Triggers referral reward if referredBy is set
========================================================= */
export const verifyEmail = async (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ error: "Email and token are required." });
  }

  try {
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.verifyToken !== token) return res.status(400).json({ error: "Invalid code." });
    if (user.verifyTokenExpiry < new Date()) {
      return res.status(400).json({ error: "Code expired. Please register again." });
    }

    user.isVerified = true;
    user.verifyToken = undefined;
    user.verifyTokenExpiry = undefined;
    await user.save();

    /* ── Fire referral reward after verify — non-blocking ── */
    if (user.referredBy) {
      creditReferralReward(user).catch((err) => {
        console.error("[verifyEmail] Referral reward failed (non-fatal):", err.message);
      });
    }

    /* ── Welcome push for first-time verified users — non-blocking ── */
    sendWelcomeNotification(user.email, user.name).catch((err) => {
      console.error("[verifyEmail] Welcome push failed (non-fatal):", err.message);
    });

    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ error: "Login after verify failed." });
      setAuthCookie(res, user);
      return res.json({ success: true });
    });

  } catch (err) {
    console.error("[verifyEmail]", err);
    return res.status(500).json({ error: "Verification failed." });
  }
};

/* =========================================================
   CREDIT REFERRAL REWARD (internal)
   Called after referee verifies email.
   Credits both referee and referrer 75 tokens each.
   Idempotent — checks for existing reward first.
========================================================= */
async function creditReferralReward(referee) {
  console.log(`[referral] Processing reward for: ${referee.email}`);

  /* ── Idempotency — prevent double crediting ── */
  const alreadyRewarded = await Transaction.findOne({
    user: referee._id,
    action: "referral_reward",
  });

  if (alreadyRewarded) {
    console.log(`[referral] Already credited to ${referee.email} — skipping`);
    return;
  }

  const referrer = await User.findById(referee.referredBy);
  if (!referrer) {
    console.warn(`[referral] Referrer not found for ${referee.email}`);
    return;
  }

  const expiresAt = addDays(new Date(), TOKEN_EXPIRY_DAYS);

  /* ── Credit referee ── */
  referee.wallet += REFERRAL_REWARD;
  await referee.save();

  await Transaction.create({
    user: referee._id,
    type: "credit",
    tokens: REFERRAL_REWARD,
    action: "referral_reward",
    expiresAt,
    status: "success",
  });

  console.log(`[referral] Credited ${REFERRAL_REWARD} tokens to referee: ${referee.email}`);

  /* ── Credit referrer ── */
  referrer.wallet += REFERRAL_REWARD;
  referrer.referralCount += 1;
  await referrer.save();

  await Transaction.create({
    user: referrer._id,
    type: "credit",
    tokens: REFERRAL_REWARD,
    action: "referral_reward",
    expiresAt,
    status: "success",
  });

  console.log(`[referral] Credited ${REFERRAL_REWARD} tokens to referrer: ${referrer.email}`);

  /* ── Email both parties — non-blocking ── */
  sendReferralRewardEmail(referee.email, referee.name, REFERRAL_REWARD, false).catch(() => { });
  sendReferralRewardEmail(referrer.email, referrer.name, REFERRAL_REWARD, true).catch(() => { });
}

/* =========================================================
   LOGIN
========================================================= */
export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const user = await User.findOne({ email });

    if (!user || !user.password) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.isVerified) {
      return res.status(403).json({ error: "Please verify your email first." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ error: "Login failed." });
      setAuthCookie(res, user);
      console.log(`[login] User logged in: ${user.email}`);
      return res.json({ success: true });
    });

  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ error: "Login failed." });
  }
};

/* =========================================================
   GOOGLE AUTH
========================================================= */
export const googleAuth = (req, res, next) => {
  if (req.query.intent) req.session.intent = req.query.intent;
  if (req.query.redirect_to) req.session.redirect_to = req.query.redirect_to;
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
};

export const googleCallback = (req, res, next) => {
  passport.authenticate("google", { failureRedirect: "/" }, (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect("/");

    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      setAuthCookie(res, user);

      if (user.isNewUser) {
        sendWelcomeNotification(user.email, user.name).catch((err) => {
          console.error("[googleCallback] Welcome push failed (non-fatal):", err.message);
        });
      }

      const isMobile = req.session.intent === "1";
      const appRedirectTo = req.session.redirect_to;
      delete req.session.intent;
      delete req.session.redirect_to;

      if (isMobile && appRedirectTo) {
        return res.redirect(`${appRedirectTo}?success=1`);
      }

      const redirectUrl =
        process.env.NODE_ENV === "production"
          ? process.env.CLIENT_URL_PROD
          : process.env.CLIENT_URL_TEST;

      return res.redirect(redirectUrl);
    });
  })(req, res, next);
};

/* =========================================================
   ME
========================================================= */
export function me(req, res) {
  if (!req.user) {
    return res.json({ isAuthenticated: false });
  }

  setAuthCookie(res, req.user);

  res.json({
    isAuthenticated: true,
    user: req.user,
    userEmail: req.user.email,
    userImage: req.user.photo,
    name: req.user.name,
    subscriptionTier: req.user.subscriptionTier,
    subscriptionStatus: req.user.subscriptionStatus,
    subscriptionPlan: req.user.subscriptionPlan,
    subscriptionExpiresAt: req.user.subscriptionExpiresAt,
  });
}

/* =========================================================
   LOGOUT
========================================================= */
export const logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session?.destroy(() => {
      res.clearCookie("connect.sid");
      clearAuthCookie(res);
      return res.json({ success: true });
    });
  });
};