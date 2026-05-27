import { Router } from "express";
import {
  verifyFlutterwavePayment,
  getSubscriptionStatus,
} from "../controllers/subscription.controller.js";

const router = Router();

router.get(
  "/status",
  getSubscriptionStatus
);

router.get(
  "/verify",
  verifyFlutterwavePayment
);

export default router;