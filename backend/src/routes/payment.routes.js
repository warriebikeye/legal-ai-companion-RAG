// src/routes/payment.routes.js
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  verifyPayment,
  flutterwaveWebhook,
} from "../controllers/payment.controller.js";

const router = express.Router();

// Webhook — no auth, verified by FLW hash header
router.post("/webhook", flutterwaveWebhook);

// Protected — user must be logged in
router.post("/verify", requireAuth, verifyPayment);

export default router;