// src/controllers/auth.controller.js
import passport from "passport";

export const googleAuth = passport.authenticate("google", {
  scope: ["profile", "email"],
});

export const googleCallback = (req, res, next) => {
  passport.authenticate("google", { failureRedirect: "/" }, (err, user) => {
     console.log("OAuth callback hit", { err, user });
    if (err) return next(err);
    if (!user) return res.redirect("/");

    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      const redirectUrl =
        process.env.NODE_ENV === 'production'
          ? process.env.CLIENT_URL_PROD
          : process.env.CLIENT_URL_TEST;

      return res.redirect(redirectUrl);
    });
  })(req, res, next);
};


export const me = (req, res) => {
  return res.json({
  isAuthenticated: req.isAuthenticated?.() === true,
  userEmail: req.user?.email,
  userImage: req.user?.photo,
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
