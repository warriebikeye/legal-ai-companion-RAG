// src/controllers/auth.controller.js
import passport from "passport";

export const googleAuth = passport.authenticate("google", {
  scope: ["profile", "email"],
});

export const googleCallback = (req, res, next) => {
  passport.authenticate("google", { failureRedirect: "/" }, (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect("/");

    // creates req.user + session
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      // Redirect based on NODE_ENV
      const redirectUrl =
        process.env.NODE_ENV === 'development'
          ? process.env.CLIENT_URL_TEST || 'http://localhost:3000' // Fallback to local URL if the environment variable is missing
          : process.env.CLIENT_URL_PROD || 'https://legal-ai-companion-rag-fr.onrender.com'; // Fallback to production URL if the environment variable is missing

      return res.redirect(`${redirectUrl}`);
    });
  })(req, res, next);
};

export const me = (req, res) => {
  return res.json({
    authenticated: req.isAuthenticated?.() === true,
    user: req.user || null,
  });
};

export const logout = (req, res, next) => {
  // Passport requires a callback for logout in newer versions :contentReference[oaicite:1]{index=1}
  req.logout((err) => {
    if (err) return next(err);
    req.session?.destroy(() => {
      res.clearCookie("connect.sid");
      return res.json({ success: true });
    });
  });
};
