// src/controllers/auth.controller.js
import passport from "passport";

export const googleAuth = (req, res, next) => {
  // ✅ Persist intent + redirect_to from query into session
  // so they survive the OAuth round-trip to Google and back
  if (req.query.intent) {
    req.session.intent = req.query.intent;
  }

  if (req.query.redirect_to) {
    req.session.redirect_to = req.query.redirect_to;
  }

  passport.authenticate("google", {
    scope: ["profile", "email"],
  })(req, res, next);
};

export const googleCallback = (req, res, next) => {
  passport.authenticate("google", { failureRedirect: "/" }, (err, user) => {
    console.log("OAuth callback hit", { err, user });

    if (err) return next(err);
    if (!user) return res.redirect("/");

    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      console.log("Session after login:", req.session);

      // ✅ Check if this was a mobile WebView request
      const isMobile = req.session.intent === "1";
      const appRedirectTo = req.session.redirect_to; // e.g. "myapp://auth/callback"

      // ✅ Clean up session flags
      delete req.session.intent;
      delete req.session.redirect_to;

      if (isMobile && appRedirectTo) {
        // ✅ Deep link back into the app — session cookie is already set
        // The app just needs to land on any page that calls /auth/me
        console.log("[Auth] Mobile WebView — redirecting to app scheme:", appRedirectTo);
        return res.redirect(`${appRedirectTo}?success=1`);
      }

      // ✅ Normal web browser redirect
      const redirectUrl =
        process.env.NODE_ENV === "production"
          ? process.env.CLIENT_URL_PROD
          : process.env.CLIENT_URL_TEST;

      return res.redirect(redirectUrl);
    });
  })(req, res, next);
};

export function me(req, res) {
  if (!req.user) {
    return res.json({ isAuthenticated: false });
  }

  res.json({
    isAuthenticated: true,
    user: req.user,
    userEmail: req.user.email,
    userImage: req.user.photo,
    subscriptionTier: req.user.subscriptionTier,
    subscriptionStatus: req.user.subscriptionStatus,
    subscriptionPlan: req.user.subscriptionPlan,
    subscriptionExpiresAt: req.user.subscriptionExpiresAt,
  });
}

export const logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session?.destroy(() => {
      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  });
};