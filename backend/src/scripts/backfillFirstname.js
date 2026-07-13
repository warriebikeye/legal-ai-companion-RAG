// src/scripts/backfillFirstname.js
//
// One-off backfill: existing users only have `name` (no firstname/lastname).
// For every user missing `firstname`, set firstname = the existing full name
// (no splitting — avoids mis-splitting compound names) and leave lastname
// blank. Not wired into app startup — run manually once:
//
//   cd backend
//   node src/scripts/backfillFirstname.js

import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("[backfillFirstname] Connected to MongoDB.");

  const users = await User.find({
    $or: [{ firstname: { $exists: false } }, { firstname: "" }],
  });

  console.log(`[backfillFirstname] Found ${users.length} user(s) missing firstname.`);

  let updated = 0;
  for (const user of users) {
    if (!user.name) continue;
    user.firstname = user.name;
    await user.save();
    updated++;
  }

  console.log(`[backfillFirstname] Updated ${updated} user(s).`);

  await mongoose.disconnect();
  console.log("[backfillFirstname] Done.");
}

run().catch((err) => {
  console.error("[backfillFirstname] Failed:", err);
  process.exit(1);
});
