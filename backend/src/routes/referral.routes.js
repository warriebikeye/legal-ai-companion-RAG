// src/routes/referral.routes.js
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getReferralInfo, sendReferralInvite, getReferralNudge } from "../controllers/referral.controller.js";

const router = express.Router();

router.get("/info",    requireAuth, getReferralInfo);
router.post("/invite", requireAuth, sendReferralInvite);
router.get("/nudge",   requireAuth, getReferralNudge);

export default router;