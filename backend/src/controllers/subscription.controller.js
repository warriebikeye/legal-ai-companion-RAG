import axios from "axios";
import User from "../models/User.js";

function log(step, data = null) {
  const timestamp = new Date().toISOString();

  if (data) {
    console.log(
      `[SUBSCRIPTION] [${timestamp}] ${step}`,
      data
    );
  } else {
    console.log(
      `[SUBSCRIPTION] [${timestamp}] ${step}`
    );
  }
}

/* =========================================================
   Get Subscription Status
========================================================= */

export async function getSubscriptionStatus(
  req,
  res
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    return res.json({
      success: true,

      subscriptionTier:
        req.user.subscriptionTier,

      subscriptionStatus:
        req.user.subscriptionStatus,

      subscriptionPlan:
        req.user.subscriptionPlan,

      subscriptionExpiresAt:
        req.user.subscriptionExpiresAt,
    });
  } catch (err) {
    console.error(
      "❌ Failed to get subscription:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to get subscription status",
    });
  }
}

/* =========================================================
   Verify Flutterwave Payment
========================================================= */

export async function verifyFlutterwavePayment(
  req,
  res
) {
  try {
    const { transaction_id } =
      req.query;

    if (!transaction_id) {
      return res.status(400).json({
        success: false,
        message:
          "transaction_id missing",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    log("Starting payment verification", {
      transaction_id,
      userId: req.user._id,
    });

    const verifyUrl = `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`;

    const response = await axios.get(
      verifyUrl,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
        },
      }
    );

    const paymentData =
      response.data?.data;

    log("Flutterwave verification response", {
      status: paymentData?.status,
      amount: paymentData?.amount,
      currency:
        paymentData?.currency,
    });

    if (
      paymentData?.status !==
      "successful"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment not successful",
      });
    }

    const amount =
      Number(paymentData.amount);

    let subscriptionPlan = "daily";
    let expiresAt = new Date();

    /* =========================================================
       Daily plan
    ========================================================= */

    if (amount <= 1000) {
      expiresAt.setDate(
        expiresAt.getDate() + 1
      );

      subscriptionPlan = "daily";
    }

    /* =========================================================
       Monthly plan
    ========================================================= */

    else {
      expiresAt.setMonth(
        expiresAt.getMonth() + 1
      );

      subscriptionPlan = "monthly";
    }

    await User.updateOne(
      {
        _id: req.user._id,
      },
      {
        $set: {
          subscriptionTier:
            "premium",

          subscriptionStatus:
            "active",

          subscriptionPlan,

          subscriptionExpiresAt:
            expiresAt,

          flutterwaveCustomerId:
            paymentData.customer?.id
              ?.toString() || "",
        },
      }
    );

    log(
      "✅ Subscription updated successfully",
      {
        userId: req.user._id,
        subscriptionPlan,
        expiresAt,
      }
    );

    return res.json({
      success: true,
      subscriptionTier:
        "premium",

      subscriptionPlan,

      expiresAt,
    });
  } catch (err) {
    console.error(
      "❌ Payment verification failed:",
      err?.response?.data || err
    );

    return res.status(500).json({
      success: false,
      message:
        "Payment verification failed",
    });
  }
}