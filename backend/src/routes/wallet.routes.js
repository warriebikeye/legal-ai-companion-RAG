// src/routes/wallet.routes.js
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getWalletBalance, getTransactionHistory } from "../controllers/wallet.controller.js";

const router = express.Router();

router.get("/balance",      requireAuth, getWalletBalance);
router.get("/transactions", requireAuth, getTransactionHistory);

export default router;