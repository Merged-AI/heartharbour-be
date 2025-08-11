import { Request, Response } from "express";
import * as stripeService from "../services/stripeService.js";

export const createFirstSubscription = async (req: Request, res: Response) => {
  try {
    const { parentName, email, password, familyName, children } = req.body;

    if (
      !parentName ||
      !email ||
      !password ||
      !familyName ||
      !children ||
      children.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "All family information is required" });
    }

    // Validate children data
    for (const child of children) {
      if (!child.name || !child.age) {
        return res
          .status(400)
          .json({ error: "Child name and age are required" });
      }
      if (
        isNaN(Number(child.age)) ||
        Number(child.age) < 3 ||
        Number(child.age) > 18
      ) {
        return res
          .status(400)
          .json({ error: "Child age must be between 3-18 years" });
      }
    }

    const result = await stripeService.createFirstSubscription(
      parentName,
      email,
      password,
      familyName,
      children
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      subscriptionId: result.subscriptionId,
      customerId: result.customerId,
      clientSecret: result.clientSecret,
      email: result.email,
      trialEnd: result.trialEnd,
      status: result.status,
      message: result.message,
    });
  } catch (error) {
    console.error("Create first subscription error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
};

export const getSubscriptionStatus = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await stripeService.getSubscriptionStatus(family);

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      hasSubscription: result.hasSubscription,
      family: result.family,
      subscription: result.subscription,
      billing: result.billing,
      customer: result.customer,
    });
  } catch (error) {
    console.error("Get subscription status error:", error);
    res.status(500).json({ error: "Failed to retrieve subscription status" });
  }
};

export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Extract cancellation feedback from request body
    const { cancellation_feedback } = req.body;

    const result = await stripeService.cancelSubscription(
      family,
      cancellation_feedback
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message,
      subscription: result.subscription,
    });
  } catch (error) {
    console.error("Cancel subscription error:", error);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
};

export const reactivateSubscription = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await stripeService.reactivateSubscription(family);

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message,
      subscription: result.subscription,
      clientSecret: result.clientSecret,
      requiresPayment: result.requiresPayment,
      reactivationType: result.reactivationType,
      paymentMethod: result.paymentMethod,
    });
  } catch (error) {
    console.error("Reactivate subscription error:", error);
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
};

export const resubscribe = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await stripeService.resubscribe(family);

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      subscriptionId: result.subscriptionId,
      customerId: result.customerId,
      clientSecret: result.clientSecret,
      trialEnd: result.trialEnd,
      status: result.status_stripe,
      message: result.message,
    });
  } catch (error) {
    console.error("Resubscribe error:", error);
    res.status(500).json({ error: "Failed to resubscribe" });
  }
};

export const createSubscriptionFromSetup = async (
  req: Request,
  res: Response
) => {
  try {
    const family = (req as any).family;
    const { setupIntentId, customerId } = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!setupIntentId || !customerId) {
      return res
        .status(400)
        .json({ error: "Setup intent ID and customer ID are required" });
    }

    const result = await stripeService.createSubscriptionFromSetup(
      family,
      setupIntentId,
      customerId
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      subscriptionId: result.subscriptionId,
      customerId: result.customerId,
      status: result.status_stripe,
      trialEnd: result.trialEnd,
      message: result.message,
    });
  } catch (error) {
    console.error("Create subscription from setup error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["stripe-signature"] as string;

    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    // Convert Buffer to string for Stripe webhook verification
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body);

    const result = await stripeService.handleWebhook(rawBody, signature);

    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Webhook handler failed" });
  }
};

export const testStripe = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await stripeService.testStripe();

    res.json({
      success: true,
      message: "Stripe connection test successful",
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Stripe test error:", error);
    res.status(500).json({ error: "Stripe test failed" });
  }
};
