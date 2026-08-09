// src/controllers/auth.controller.js
import passport from "passport";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import {
  sendVerificationEmail,
  sendReferralRewardEmail,
  sendPasswordChangedEmail,
  sendPasswordChangeCodeEmail,
} from "../utils/mailer.js";
import { setAuthCookie, clearAuthCookie } from "../utils/setAuthCookie.js";
import { REFERRAL_REWARD, TOKEN_EXPIRY_DAYS } from "../config/tokens.js";
import { sendDailyResetNotification, sendWelcomeNotification } from "../utils/onesignal.js";
import { uploadAvatar } from "../utils/cloudinary.js";

/* ─── Helper ─── */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/* ─── Welcome push — delayed ───
   oneSignalLogin(email) only runs client-side AFTER this request
   resolves, and can itself take up to ~10s waiting for the native
   Median bridge. Sending immediately races the device linking
   itself to this email in OneSignal, so the push would silently
   match 0 recipients. Delaying gives that linkage time to land. */
const WELCOME_PUSH_DELAY_MS = 7000;

function sendWelcomeNotificationDelayed(email, firstname) {
  setTimeout(() => {
    sendWelcomeNotification(email, firstname).catch((err) => {
      console.error("[welcomeNotification] Welcome push failed (non-fatal):", err.message);
    });
  }, WELCOME_PUSH_DELAY_MS);
}

/* =========================================================
   REGISTER
   Accepts optional referralCode from body or ?ref= query
========================================================= */
export const register = async (req, res) => {
  const { email, password, firstname, lastname } = req.body;

  // Read referral code from body or query string
  const referralCode = (
    req.body.referralCode ||
    req.query.ref ||
    ""
  ).toUpperCase().trim();

  if (!email || !password || !firstname) {
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
      existing.firstname = firstname;
      existing.lastname = lastname || "";
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
        firstname,
        lastname: lastname || "",
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

    /* ── Welcome push for first-time verified users — delayed, non-blocking ── */
    sendWelcomeNotificationDelayed(user.email, user.firstname || user.name);

    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ error: "Login after verify failed." });
      const authToken = setAuthCookie(res, user);
      return res.json({ success: true, token: authToken });
    });

  } catch (err) {
    console.error("[verifyEmail]", err);
    return res.status(500).json({ error: "Verification failed." });
  }
};

/* =========================================================
   CREDIT REFERRAL REWARD (internal)
   Called after referee verifies email.
   Credits only the REFERRER 75 tokens — the referee gets no
   reward for being referred.
   Idempotent — checks for an existing reward tied to this
   specific referee first.
========================================================= */
async function creditReferralReward(referee) {
  console.log(`[referral] Processing reward for: ${referee.email}`);

  const referrer = await User.findById(referee.referredBy);
  if (!referrer) {
    console.warn(`[referral] Referrer not found for ${referee.email}`);
    return;
  }

  /* ── Idempotency — prevent double crediting the referrer for this referee ── */
  const alreadyRewarded = await Transaction.findOne({
    user: referrer._id,
    referredUser: referee._id,
    action: "referral_reward",
  });

  if (alreadyRewarded) {
    console.log(`[referral] Referrer already credited for ${referee.email} — skipping`);
    return;
  }

  const expiresAt = addDays(new Date(), TOKEN_EXPIRY_DAYS);

  /* ── Credit referrer only ── */
  referrer.wallet += REFERRAL_REWARD;
  referrer.referralCount += 1;
  await referrer.save();

  await Transaction.create({
    user: referrer._id,
    referredUser: referee._id,
    type: "credit",
    tokens: REFERRAL_REWARD,
    action: "referral_reward",
    expiresAt,
    status: "success",
  });

  console.log(`[referral] Credited ${REFERRAL_REWARD} tokens to referrer: ${referrer.email}`);

  /* ── Email referrer only — non-blocking ── */
  sendReferralRewardEmail(referrer.email, referrer.firstname || referrer.name, REFERRAL_REWARD).catch(() => { });
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
      const authToken = setAuthCookie(res, user);
      console.log(`[login] User logged in: ${user.email}`);
      return res.json({ success: true, token: authToken });
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
        sendWelcomeNotificationDelayed(user.email, user.firstname || user.name);
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

  const authToken = setAuthCookie(res, req.user);

  res.json({
    isAuthenticated: true,
    userEmail: req.user.email,
    userImage: req.user.photo,
    name: req.user.name,
    firstname: req.user.firstname,
    lastname: req.user.lastname,
    hasPassword: !!req.user.password,
    subscriptionTier: req.user.subscriptionTier,
    subscriptionStatus: req.user.subscriptionStatus,
    subscriptionPlan: req.user.subscriptionPlan,
    subscriptionExpiresAt: req.user.subscriptionExpiresAt,
    token: authToken,
  });
}

/* =========================================================
   UPDATE PROFILE
========================================================= */
export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id || req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const { firstname, lastname } = req.body;

    if (firstname !== undefined) {
      const trimmed = String(firstname).trim();
      if (!trimmed) {
        return res.status(400).json({ error: "First name cannot be empty." });
      }
      user.firstname = trimmed;
    }

    if (lastname !== undefined) {
      user.lastname = String(lastname).trim();
    }

    await user.save();

    const token = setAuthCookie(res, user);

    return res.json({
      success: true,
      firstname: user.firstname,
      lastname: user.lastname,
      photo: user.photo,
      email: user.email,
      subscriptionTier: user.subscriptionTier,
      subscriptionStatus: user.subscriptionStatus,
      token,
    });
  } catch (err) {
    console.error("[updateProfile]", err);
    return res.status(500).json({ error: "Failed to update profile." });
  }
};

/* =========================================================
   CHANGE PASSWORD — two-step, email-code confirmed

   1. requestPasswordChange: verifies currentPassword, hashes
      newPassword, stashes it as pendingPasswordHash, emails a
      6-digit code. Nothing about the live password changes yet.
   2. confirmPasswordChange: checks the code, and only then
      promotes pendingPasswordHash to the real password.
========================================================= */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_CHANGE_CODE_TTL_MS = 15 * 60 * 1000;

function passwordStrengthError(password) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include both letters and numbers.";
  }
  return null;
}

export const requestPasswordChange = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required." });
    }

    const strengthError = passwordStrengthError(newPassword);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const user = await User.findById(req.user._id || req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (!user.password) {
      return res.status(400).json({
        error: "This account signed in with Google and has no password set.",
      });
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.password);
    if (!currentMatches) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
    if (sameAsCurrent) {
      return res.status(400).json({ error: "New password must be different from your current password." });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    user.pendingPasswordHash = await bcrypt.hash(newPassword, 12);
    user.passwordChangeCode = code;
    user.passwordChangeCodeExpiry = new Date(Date.now() + PASSWORD_CHANGE_CODE_TTL_MS);
    await user.save();

    await sendPasswordChangeCodeEmail(user.email, user.firstname || user.name, code);

    return res.json({ success: true, message: "Confirmation code sent to your email." });
  } catch (err) {
    console.error("[requestPasswordChange]", err);
    return res.status(500).json({ error: "Failed to start password change." });
  }
};

export const confirmPasswordChange = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Confirmation code is required." });
    }

    const user = await User.findById(req.user._id || req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (!user.pendingPasswordHash || !user.passwordChangeCode) {
      return res.status(400).json({ error: "No pending password change. Please start over." });
    }

    if (user.passwordChangeCodeExpiry < new Date()) {
      user.pendingPasswordHash = undefined;
      user.passwordChangeCode = undefined;
      user.passwordChangeCodeExpiry = undefined;
      await user.save();
      return res.status(400).json({ error: "Code expired. Please start over." });
    }

    if (user.passwordChangeCode !== String(code)) {
      return res.status(401).json({ error: "Invalid code." });
    }

    user.password = user.pendingPasswordHash;
    user.pendingPasswordHash = undefined;
    user.passwordChangeCode = undefined;
    user.passwordChangeCodeExpiry = undefined;
    await user.save();

    sendPasswordChangedEmail(user.email, user.firstname || user.name).catch((err) => {
      console.error("[confirmPasswordChange] Notification email failed (non-fatal):", err.message);
    });

    return res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    console.error("[confirmPasswordChange]", err);
    return res.status(500).json({ error: "Failed to confirm password change." });
  }
};

/* =========================================================
   UPLOAD AVATAR
========================================================= */
export const uploadAvatarHandler = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    const user = await User.findById(req.user._id || req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const result = await uploadAvatar(req.file.buffer, user._id);

    user.photo = result.secure_url;
    await user.save();

    const token = setAuthCookie(res, user);

    return res.json({
      success: true,
      photo: user.photo,
      token,
    });
  } catch (err) {
    console.error("[uploadAvatarHandler]", err);
    return res.status(500).json({ error: "Failed to upload avatar." });
  }
};

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