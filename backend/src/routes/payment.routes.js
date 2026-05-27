import express from "express";

const router = express.Router();

import {
  verifyPayment,
} from "../controllers/payment.controller.js";

router.post(
  "/verify",
  verifyPayment
);

export default router;