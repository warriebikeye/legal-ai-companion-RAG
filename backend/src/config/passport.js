// src/config/passport.js
import passport from "passport";
import pkg from "passport-google-oauth20";

const { Strategy: GoogleStrategy } = pkg;

// Set the callback URL based on the environment
const callbackURL =
  process.env.NODE_ENV === 'production'
    ? process.env.GOOGLE_CALLBACK_URL_PROD
    : process.env.GOOGLE_CALLBACK_URL_TEST;

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: callbackURL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        return done(null, profile);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));
