// src/controllers/auth.controller.js
import passport from "passport";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { sendVerificationEmail } from "../utils/mailer.js";
import { setAuthCookie, clearAuthCookie } from "../utils/setAuthCookie.js";

/* =========================================================
   REGISTER — create unverified user, send 6-digit token
========================================================= */
export const register = async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const existing = await User.findOne({ email });

    if (existing?.isVerified) {
      return res.status(409).json({ error: "Email already registered. Please log in." });
    }

    const token  = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    const hashed = await bcrypt.hash(password, 12);

    if (existing && !existing.isVerified) {
      existing.password        = hashed;
      existing.name            = name;
      existing.verifyToken     = token;
      existing.verifyTokenExpiry = expiry;
      await existing.save();
    } else {
      await User.create({
        email,
        name,
        password: hashed,
        isVerified: false,
        verifyToken: token,
        verifyTokenExpiry: expiry,
      });
    }

    await sendVerificationEmail(email, token);
    return res.json({ success: true, message: "Verification code sent." });

  } catch (err) {
    console.error("[register]", err);
    return res.status(500).json({ error: "Registration failed." });
  }
};

/* =========================================================
   VERIFY EMAIL — confirm token, log user in, set cookie
========================================================= */
export const verifyEmail = async (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ error: "Email and token are required." });
  }

  try {
    const user = await User.findOne({ email });

    if (!user)                           return res.status(404).json({ error: "User not found." });
    if (user.verifyToken !== token)      return res.status(400).json({ error: "Invalid code." });
    if (user.verifyTokenExpiry < new Date()) {
      return res.status(400).json({ error: "Code expired. Please register again." });
    }

    user.isVerified        = true;
    user.verifyToken       = undefined;
    user.verifyTokenExpiry = undefined;
    await user.save();

    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ error: "Login after verify failed." });

      // ✅ Set persistent auth cookie
      setAuthCookie(res, user);
      return res.json({ success: true });
    });

  } catch (err) {
    console.error("[verifyEmail]", err);
    return res.status(500).json({ error: "Verification failed." });
  }
};

/* =========================================================
   LOGIN — email + password, set cookie
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

      // ✅ Set persistent auth cookie
      setAuthCookie(res, user);
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
  if (req.query.intent)       req.session.intent      = req.query.intent;
  if (req.query.redirect_to)  req.session.redirect_to = req.query.redirect_to;

  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
};

export const googleCallback = (req, res, next) => {
  passport.authenticate("google", { failureRedirect: "/" }, (err, user) => {
    if (err)   return next(err);
    if (!user) return res.redirect("/");

    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      // ✅ Set persistent auth cookie for Google users too
      setAuthCookie(res, user);

      const isMobile     = req.session.intent === "1";
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
   ME — still available as fallback / forced refresh
========================================================= */
export function me(req, res) {
  if (!req.user) {
    return res.json({ isAuthenticated: false });
  }

  // ✅ Refresh cookie on every /auth/me call so active users
  //    never hit expiry (rolling 30-day window)
  setAuthCookie(res, req.user);

  res.json({
    isAuthenticated:    true,
    user:               req.user,
    userEmail:          req.user.email,
    userImage:          req.user.photo,
    name:               req.user.name,
    subscriptionTier:   req.user.subscriptionTier,
    subscriptionStatus: req.user.subscriptionStatus,
    subscriptionPlan:   req.user.subscriptionPlan,
    subscriptionExpiresAt: req.user.subscriptionExpiresAt,
  });
}

/* =========================================================
   LOGOUT — clear session + auth cookie
========================================================= */
export const logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);

    req.session?.destroy(() => {
      res.clearCookie("connect.sid");

      // ✅ Also clear the persistent auth cookie
      clearAuthCookie(res);

      return res.json({ success: true });
    });
  });
};