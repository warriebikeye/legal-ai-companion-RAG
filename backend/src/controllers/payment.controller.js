import axios from "axios";

import User from "../models/User.js";


/* =========================================
   VERIFY PAYMENT
========================================= */

export const verifyPayment =
  async (req, res) => {
    console.log(
      "\n========================================"
    );

    console.log(
      "VERIFY PAYMENT CONTROLLER STARTED"
    );

    console.log(
      "REQUEST TIME:",
      new Date().toISOString()
    );

    try {
      /* =========================================
         REQUEST BODY
      ========================================= */

      console.log(
        "RAW REQUEST BODY:",
        req.body
      );

      const {
        transactionId,
        txRef,
      } = req.body;

      console.log(
        "EXTRACTED PAYMENT DATA:",
        {
          transactionId,
          txRef,
        }
      );

      /* =========================================
         VALIDATE TRANSACTION ID
      ========================================= */

      if (!transactionId) {
        console.log(
          "TRANSACTION ID MISSING"
        );

        return res.status(400).json({
          success: false,
          message:
            "Transaction ID is required.",
        });
      }

      console.log(
        "TRANSACTION ID VALIDATED"
      );

      /* =========================================
         VERIFY WITH FLUTTERWAVE
      ========================================= */

      console.log(
        "CALLING FLUTTERWAVE VERIFY API..."
      );

      console.log(
        "VERIFY URL:",
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`
      );

      const FLUTTERWAVE_SECRET_KEY =
        process.env.FLW_SECRET_KEY;
      console.log(
        "FLW SECRET:",
        process.env.FLW_SECRET_KEY
      );

      const flutterwaveResponse =
        await axios.get(
          `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
          {
            headers: {
              Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
            },
          }
        );

      console.log(
        "FLUTTERWAVE API CALL SUCCESSFUL"
      );

      const paymentData =
        flutterwaveResponse.data;

      console.log(
        "FULL FLUTTERWAVE RESPONSE:"
      );

      console.log(
        JSON.stringify(
          paymentData,
          null,
          2
        )
      );

      /* =========================================
         VALIDATE FLUTTERWAVE RESPONSE
      ========================================= */

      console.log(
        "VALIDATING FLUTTERWAVE RESPONSE STATUS..."
      );

      if (
        paymentData.status !==
        "success"
      ) {
        console.log(
          "FLUTTERWAVE RESPONSE STATUS FAILED"
        );

        return res.status(400).json({
          success: false,
          message:
            "Payment verification failed.",
        });
      }

      console.log(
        "FLUTTERWAVE RESPONSE STATUS VALID"
      );

      const payment =
        paymentData.data;

      console.log(
        "PAYMENT DATA:",
        payment
      );

      /* =========================================
         VALIDATE PAYMENT STATUS
      ========================================= */

      console.log(
        "CHECKING PAYMENT STATUS..."
      );

      if (
        payment.status !==
        "successful"
      ) {
        console.log(
          "PAYMENT STATUS NOT SUCCESSFUL:",
          payment.status
        );

        return res.status(400).json({
          success: false,
          message:
            "Payment not successful.",
        });
      }

      console.log(
        "PAYMENT STATUS VERIFIED SUCCESSFULLY"
      );

      /* =========================================
         AUTHENTICATED USER CHECK
      ========================================= */

      console.log(
        "CHECKING AUTHENTICATED USER..."
      );

      console.log(
        "REQ.USER:",
        req.user
      );

      if (!req.user) {
        console.log(
          "NO AUTHENTICATED USER FOUND"
        );

        return res.status(401).json({
          success: false,
          message:
            "Unauthorized.",
        });
      }

      console.log(
        "AUTHENTICATED USER VERIFIED"
      );

      /* =========================================
         FETCH USER FROM DATABASE
      ========================================= */

      console.log(
        "FETCHING USER FROM DATABASE..."
      );

      const user =
        await User.findById(
          req.user._id
        );

      console.log(
        "DATABASE USER RESULT:",
        user
      );

      if (!user) {
        console.log(
          "USER NOT FOUND IN DATABASE"
        );

        return res.status(404).json({
          success: false,
          message:
            "User not found.",
        });
      }

      console.log(
        "USER FOUND SUCCESSFULLY"
      );

      /* =========================================
         DETERMINE SUBSCRIPTION PLAN
      ========================================= */

      console.log(
        "DETERMINING SUBSCRIPTION PLAN..."
      );

      const amount =
        payment.amount;

      console.log(
        "PAYMENT AMOUNT:",
        amount
      );

      let subscriptionType =
        "daily";

      let expiryDate =
        new Date();

      /*
        ₦300 = daily
        ₦4800 = monthly
      */

      if (amount >= 4800) {
        subscriptionType =
          "monthly";

        expiryDate.setDate(
          expiryDate.getDate() + 30
        );

        console.log(
          "MONTHLY PLAN DETECTED"
        );
      } else {
        expiryDate.setDate(
          expiryDate.getDate() + 1
        );

        console.log(
          "DAILY PLAN DETECTED"
        );
      }

      console.log(
        "SUBSCRIPTION DETAILS:",
        {
          subscriptionType,
          expiryDate,
        }
      );

      /* =========================================
         UPDATE USER SUBSCRIPTION
      ========================================= */

      console.log(
        "UPDATING USER SUBSCRIPTION..."
      );

      user.subscriptionTier =
        "premium";

      user.subscriptionType =
        subscriptionType;

      user.subscriptionExpiry =
        expiryDate;

      user.lastPaymentReference =
        txRef;

      console.log(
        "SAVING USER..."
      );

      await user.save();

      console.log(
        "USER SAVE SUCCESSFUL"
      );

      console.log(
        "UPDATED USER:",
        {
          userId: user._id,
          subscriptionTier:
            user.subscriptionTier,
          subscriptionType:
            user.subscriptionType,
          subscriptionExpiry:
            user.subscriptionExpiry,
          lastPaymentReference:
            user.lastPaymentReference,
        }
      );

      console.log(
        "VERIFY PAYMENT FLOW COMPLETED SUCCESSFULLY"
      );

      console.log(
        "========================================\n"
      );

      return res.json({
        success: true,
        message:
          "Payment verified successfully.",

        subscriptionTier:
          user.subscriptionTier,

        subscriptionType:
          user.subscriptionType,

        subscriptionExpiry:
          user.subscriptionExpiry,
      });
    } catch (error) {
      console.error(
        "\nVERIFY PAYMENT ERROR OCCURRED"
      );

      console.error(
        "ERROR MESSAGE:",
        error.message
      );

      console.error(
        "ERROR RESPONSE:",
        error.response?.data
      );

      console.error(
        "FULL ERROR:",
        error
      );

      console.log(
        "========================================\n"
      );

      return res.status(500).json({
        success: false,
        message:
          "Internal server error.",
      });
    }
  };