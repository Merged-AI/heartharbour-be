import { Router } from "express";
import * as stripeController from "../controllers/stripeController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// POST /api/stripe/create-subscription-first - Create first-time subscription
router.post(
  "/create-subscription-first",
  stripeController.createFirstSubscription
);

// POST /api/stripe/cancel-subscription - Cancel subscription
router.post(
  "/cancel-subscription",
  authenticateUser,
  stripeController.cancelSubscription
);

// POST /api/stripe/reactivate-subscription - Reactivate subscription
router.post(
  "/reactivate-subscription",
  authenticateUser,
  stripeController.reactivateSubscription
);

// POST /api/stripe/resubscribe - Resubscribe after cancellation
router.post("/resubscribe", authenticateUser, stripeController.resubscribe);

// POST /api/stripe/create-subscription-from-setup - Create subscription from setup intent
router.post(
  "/create-subscription-from-setup",
  authenticateUser,
  stripeController.createSubscriptionFromSetup
);

// GET /api/stripe/subscription-status - Get subscription status
router.get(
  "/subscription-status",
  authenticateUser,
  stripeController.getSubscriptionStatus
);

// POST /api/stripe/webhook - Stripe webhook handler (no auth required)
router.post("/webhook", stripeController.handleWebhook);

// GET /api/stripe/test - Test endpoint for Stripe
router.get("/test", authenticateUser, stripeController.testStripe);

export default router;
