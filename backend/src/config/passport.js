// src/config/passport.js
import passport from "passport";
import pkg from "passport-google-oauth20";
import User from "../models/User.js";

const { Strategy: GoogleStrategy } = pkg;

// Set the callback URL based on the environment
const callbackURL =
  process.env.NODE_ENV === "production"
    ? process.env.GOOGLE_CALLBACK_URL_PROD
    : process.env.GOOGLE_CALLBACK_URL_TEST;

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // ✅ Pull useful fields from Google
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value || "";
        const name = profile.displayName || "";
        const photo = profile.photos?.[0]?.value || "";

        // ✅ Find or create user in MongoDB
        let user = await User.findOne({ googleId });

        if (!user) {
          user = await User.create({
            googleId,
            email,
            name,
            photo,
          });
          // Transient flag (not a schema field, not persisted) so the callback knows this is a first-time signup
          user.isNewUser = true;
        } else {
          // Optional: keep user details updated
          const updates = {};
          if (email && user.email !== email) updates.email = email;
          if (name && user.name !== name) updates.name = name;
          if (photo && user.photo !== photo) updates.photo = photo;

          if (Object.keys(updates).length) {
            user = await User.findByIdAndUpdate(user._id, updates, { new: true });
          }
        }

        // ✅ Pass MongoDB user forward
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// ✅ Store only MongoDB user id in session
passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

// ✅ Restore full user from MongoDB on each request
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).lean();
    done(null, user || null);
  } catch (err) {
    done(err);
  }
});
