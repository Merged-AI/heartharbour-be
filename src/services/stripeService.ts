import Stripe from "stripe";
import { createServerSupabase } from "../lib/supabase.js";

// Server-side Stripe instance
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
  typescript: true,
});

// Lily Heart pricing configuration
export const PRICING_PLANS = {
  family_coach: {
    name: "Family Communication Coach",
    description: "Everything your family needs to build better communication",
    price: 3900, // $39.00 in cents
    currency: "usd",
    interval: "month",
    trial_period_days: 0.00139, // 2 minutes (2/1440 days)
    features: [
      "Unlimited AI Conversations (up to 4 family members)",
      "Parent Dashboard with conversation insights",
      "Appointment Preparation Tools",
      "24/7 Emotional Support Companion",
      "Family Progress Tracking",
      "Age-Appropriate AI Coaching (3-18 years)",
      "Crisis Support Resources",
    ],
  },
} as const;

interface StripeResult {
  success: boolean;
  error?: string;
  status?: number;
  subscriptionId?: string;
  customerId?: string;
  clientSecret?: string | null;
  email?: string;
  trialEnd?: number | null;
  status_stripe?: string;
  message?: string;
  hasSubscription?: boolean;
  family?: any;
  subscription?: any;
  billing?: any;
  customer?: any;
  requiresPayment?: boolean;
  reactivationType?: string;
  paymentMethod?: string;
}

// Create or retrieve Stripe customer
async function createOrRetrieveCustomer(email: string, name: string) {
  // Check if customer already exists
  const existingCustomers = await stripe.customers.list({
    email: email,
    limit: 1,
  });

  if (existingCustomers.data.length > 0) {
    return existingCustomers.data[0];
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      platform: "heart-harbor",
    },
  });

  return customer;
}

// Create subscription with trial
async function createSubscription(customerId: string, priceId: string) {
  const trialEnd = Math.floor(Date.now() / 1000) + 2 * 60; // Current time + 2 minutes in seconds

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_end: trialEnd,
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
  });

  return subscription;
}

// Get or create product and price in Stripe
async function ensureProductAndPrice() {
  // Check if product exists
  const products = await stripe.products.list({
    active: true,
    limit: 100,
  });

  let product = products.data.find(
    (p) => p.metadata.plan_id === "family_coach"
  );

  if (!product) {
    // Create product
    product = await stripe.products.create({
      name: PRICING_PLANS.family_coach.name,
      description: PRICING_PLANS.family_coach.description,
      metadata: {
        plan_id: "family_coach",
        platform: "heart-harbor",
      },
    });
  }

  // Check if price exists for this product
  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
  });

  let price = prices.data.find(
    (p) =>
      p.unit_amount === PRICING_PLANS.family_coach.price &&
      p.currency === PRICING_PLANS.family_coach.currency &&
      p.recurring?.interval === PRICING_PLANS.family_coach.interval
  );

  if (!price) {
    // Create price
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: PRICING_PLANS.family_coach.price,
      currency: PRICING_PLANS.family_coach.currency,
      recurring: {
        interval: PRICING_PLANS.family_coach.interval as "month",
      },
      metadata: {
        plan_id: "family_coach",
      },
    });
  }

  return { product, price };
}

export async function createFirstSubscription(
  parentName: string,
  email: string,
  password: string,
  familyName: string,
  children: any[]
): Promise<StripeResult> {
  try {
    console.log("Creating Stripe subscription first for:", email);

    // Ensure Stripe product and price exist
    const { price } = await ensureProductAndPrice();

    // Create Stripe customer with family metadata
    const customer = await createOrRetrieveCustomer(email, parentName);

    // Add family metadata to customer
    await stripe.customers.update(customer.id, {
      metadata: {
        parent_name: parentName,
        family_name: familyName,
        parent_email: email,
        password: password, // We'll use this in webhook to create user
        children_data: JSON.stringify(children),
        platform: "heart-harbor",
      },
    });

    // Create subscription with 7-day trial
    const subscription = await createSubscription(customer.id, price.id);

    console.log(
      "Stripe subscription created:",
      subscription.id,
      "for customer:",
      customer.id
    );

    // Get client secret for payment setup
    let clientSecret = null;

    // Handle latest_invoice expansion
    if (
      subscription.latest_invoice &&
      typeof subscription.latest_invoice === "object"
    ) {
      const invoice = subscription.latest_invoice as any;
      if (
        invoice.payment_intent &&
        typeof invoice.payment_intent === "object"
      ) {
        clientSecret = invoice.payment_intent.client_secret;
      }
    }

    // Handle pending_setup_intent expansion
    if (
      !clientSecret &&
      subscription.pending_setup_intent &&
      typeof subscription.pending_setup_intent === "object"
    ) {
      const setupIntent = subscription.pending_setup_intent as any;
      clientSecret = setupIntent.client_secret;
    }

    return {
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      clientSecret,
      email: email,
      trialEnd: subscription.trial_end,
      status_stripe: subscription.status,
      message:
        "Subscription created! User account will be created after payment confirmation.",
    };
  } catch (error) {
    console.error("Stripe-first subscription creation error:", error);
    return {
      success: false,
      error: "Failed to create subscription",
      status: 500,
    };
  }
}

export async function getSubscriptionStatus(
  family: any
): Promise<StripeResult> {
  try {
    // Check if we have Stripe subscription ID stored
    if (!family.stripe_subscription_id) {
      return {
        success: true,
        hasSubscription: false,
        family: {
          subscription_status: family.subscription_status || "inactive",
          trial_ends_at: family.trial_ends_at,
          parent_email: family.parent_email,
        },
      };
    }

    // Get detailed subscription info from Stripe
    const subscription = await stripe.subscriptions.retrieve(
      family.stripe_subscription_id,
      {
        expand: ["default_payment_method", "latest_invoice"],
      }
    );

    // Get customer info for payment method details
    const customer = await stripe.customers.retrieve(
      subscription.customer as string
    );

    return {
      success: true,
      hasSubscription: true,
      family: {
        subscription_status: family.subscription_status,
        trial_ends_at: family.trial_ends_at,
        subscription_canceled_at: family.subscription_canceled_at,
        last_payment_at: family.last_payment_at,
        parent_email: family.parent_email,
      },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_start: (subscription as any).items?.data?.[0]
          ?.current_period_start,
        current_period_end: (subscription as any).items?.data?.[0]
          ?.current_period_end,
        trial_end: subscription.trial_end,
        canceled_at: subscription.canceled_at,
        // Include our custom status for better UX
        effective_status:
          family.subscription_status === "canceling"
            ? "canceling"
            : subscription.status,
      },
      billing: {
        amount: subscription.items.data[0]?.price?.unit_amount || 3900,
        currency: subscription.items.data[0]?.price?.currency || "usd",
        interval:
          subscription.items.data[0]?.price?.recurring?.interval || "month",
      },
      customer: {
        email: (customer as any).email,
        name: (customer as any).name,
      },
    };
  } catch (error) {
    console.error("Subscription status error:", error);
    return {
      success: false,
      error: "Failed to retrieve subscription status",
      status: 500,
    };
  }
}

export async function cancelSubscription(family: any): Promise<StripeResult> {
  try {
    if (!family.stripe_subscription_id) {
      return {
        success: false,
        error: "No active subscription found",
        status: 400,
      };
    }

    // Check if subscription is already canceled
    if (family.subscription_status === "canceled") {
      return {
        success: false,
        error: "Subscription is already canceled",
        status: 400,
      };
    }

    // Cancel the subscription in Stripe (at period end)
    const canceledSubscription = await stripe.subscriptions.update(
      family.stripe_subscription_id,
      {
        cancel_at_period_end: true,
        metadata: {
          canceled_by: "user",
          canceled_at: new Date().toISOString(),
        },
      }
    );

    // Update the family record in Supabase to reflect cancellation
    const supabase = createServerSupabase();
    const { error: updateError } = await supabase
      .from("families")
      .update({
        subscription_canceled_at: new Date().toISOString(),
        subscription_status: "canceling", // New status to indicate pending cancellation
        // The webhook will handle the final status change to 'canceled' when period ends
      })
      .eq("id", family.id);

    if (updateError) {
      console.error("Error updating family record:", updateError);
      // Continue anyway since Stripe was updated
    }

    return {
      success: true,
      message: "Subscription canceled successfully",
      subscription: {
        id: canceledSubscription.id,
        status: canceledSubscription.status,
        cancel_at_period_end: canceledSubscription.cancel_at_period_end,
        current_period_end: (canceledSubscription as any).current_period_end,
      },
    };
  } catch (error) {
    console.error("Subscription cancellation error:", error);
    return {
      success: false,
      error: "Failed to cancel subscription",
      status: 500,
    };
  }
}

export async function reactivateSubscription(
  family: any
): Promise<StripeResult> {
  try {
    if (!family.stripe_subscription_id) {
      return {
        success: false,
        error: "No subscription found",
        status: 400,
      };
    }

    // Check if subscription is in canceling or canceled status
    if (family.subscription_status !== "canceling" && family.subscription_status !== "canceled") {
      return {
        success: false,
        error: "Subscription is not marked for cancellation",
        status: 400,
      };
    }

    const supabase = createServerSupabase();
    let reactivatedSubscription;

    if (family.subscription_status === "canceled") {
      // For canceled subscriptions, we need to create a new subscription
      // since Stripe doesn't allow updating canceled subscriptions
      
      // Get the existing customer
      const existingSubscription = await stripe.subscriptions.retrieve(family.stripe_subscription_id);
      const customerId = existingSubscription.customer as string;
      
      // Get the price from the canceled subscription
      const priceId = existingSubscription.items.data[0].price.id;
      
      // Check if customer has a default payment method
      const customer = await stripe.customers.retrieve(customerId);
      
      // Check multiple sources for payment methods
      const invoiceDefaultPaymentMethod = customer && !customer.deleted && 
        (customer as any).invoice_settings?.default_payment_method;
      const legacyDefaultSource = customer && !customer.deleted && 
        (customer as any).default_source;
      
      // List payment methods attached to customer
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });
      
      const hasDefaultPaymentMethod = !!(invoiceDefaultPaymentMethod || legacyDefaultSource);
      const hasAnyPaymentMethods = paymentMethods.data.length > 0;
      
      console.log("🔍 Customer payment method check:", {
        customerId,
        invoiceDefaultPaymentMethod,
        legacyDefaultSource,
        hasDefaultPaymentMethod,
        hasAnyPaymentMethods,
        paymentMethodsCount: paymentMethods.data.length,
        customerDeleted: customer ? customer.deleted : 'no customer'
      });
      
      // Update customer metadata for reactivation tracking
      await stripe.customers.update(customerId, {
        metadata: {
          platform: "heart-harbor",
          reactivation: "true",
          family_id: family.id.toString(),
          previous_subscription_id: family.stripe_subscription_id,
        },
      });
      
      // Try to create active subscription first if we have payment methods
      if (hasDefaultPaymentMethod || hasAnyPaymentMethods) {
        try {
          // Set the default payment method on subscription and use allow_incomplete
          const subscriptionParams: any = {
            customer: customerId,
            items: [{ price: priceId }],
            payment_behavior: 'allow_incomplete', // Allow incomplete, but try payment
            expand: ['latest_invoice.payment_intent'],
            metadata: {
              reactivated_by: "user",
              reactivated_at: new Date().toISOString(),
              previous_subscription_id: family.stripe_subscription_id,
            },
          };

          // Preserve trial period if family still has trial time remaining
          if (family.trial_ends_at) {
            const trialEndDate = new Date(family.trial_ends_at);
            const now = new Date();
            if (trialEndDate > now) {
              // Convert to Unix timestamp for Stripe
              subscriptionParams.trial_end = Math.floor(trialEndDate.getTime() / 1000);
              console.log("🔄 Preserving trial period until:", family.trial_ends_at);
            }
          }

          // If we have a default payment method, set it explicitly
          if (invoiceDefaultPaymentMethod) {
            subscriptionParams.default_payment_method = invoiceDefaultPaymentMethod;
          } else if (hasAnyPaymentMethods && paymentMethods.data.length > 0) {
            // Use the first available payment method
            subscriptionParams.default_payment_method = paymentMethods.data[0].id;
          }

          reactivatedSubscription = await stripe.subscriptions.create(subscriptionParams);
          
          console.log("✅ Subscription reactivated with payment method:", {
            subscriptionId: reactivatedSubscription.id,
            status: reactivatedSubscription.status,
            defaultPaymentMethod: subscriptionParams.default_payment_method,
            currentPeriodStart: (reactivatedSubscription as any).current_period_start,
            currentPeriodEnd: (reactivatedSubscription as any).current_period_end
          });
        } catch (error: any) {
          console.log("❌ Direct payment failed, falling back to incomplete flow:", {
            errorMessage: error.message,
            errorCode: error.code,
            errorType: error.type
          });
          
          // Fall back to incomplete payment flow
          const fallbackParams: any = {
            customer: customerId,
            items: [{ price: priceId }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
            metadata: {
              reactivated_by: "user",
              reactivated_at: new Date().toISOString(),
              previous_subscription_id: family.stripe_subscription_id,
              fallback_reason: error.message,
            },
          };

          // Preserve trial period if family still has trial time remaining
          if (family.trial_ends_at) {
            const trialEndDate = new Date(family.trial_ends_at);
            const now = new Date();
            if (trialEndDate > now) {
              fallbackParams.trial_end = Math.floor(trialEndDate.getTime() / 1000);
            }
          }

          reactivatedSubscription = await stripe.subscriptions.create(fallbackParams);
        }
      } else {
        // No default payment method, use incomplete flow
        console.log("No default payment method found, using incomplete flow");
        const noPaymentMethodParams: any = {
          customer: customerId,
          items: [{ price: priceId }],
          payment_behavior: 'default_incomplete',
          payment_settings: { save_default_payment_method: 'on_subscription' },
          expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
          metadata: {
            reactivated_by: "user",
            reactivated_at: new Date().toISOString(),
            previous_subscription_id: family.stripe_subscription_id,
          },
        };

        // Preserve trial period if family still has trial time remaining
        if (family.trial_ends_at) {
          const trialEndDate = new Date(family.trial_ends_at);
          const now = new Date();
          if (trialEndDate > now) {
            noPaymentMethodParams.trial_end = Math.floor(trialEndDate.getTime() / 1000);
          }
        }

        reactivatedSubscription = await stripe.subscriptions.create(noPaymentMethodParams);
      }

      // Update family record with new subscription ID
      await supabase
        .from("families")
        .update({
          stripe_subscription_id: reactivatedSubscription.id,
        })
        .eq("id", family.id);

    } else {
      // For canceling subscriptions, we can update normally - no new billing, just continue current cycle
      console.log("🔄 Removing cancellation from existing subscription:", family.stripe_subscription_id);
      reactivatedSubscription = await stripe.subscriptions.update(
        family.stripe_subscription_id,
        {
          cancel_at_period_end: false,
          metadata: {
            reactivated_by: "user",
            reactivated_at: new Date().toISOString(),
          },
        }
      );
      console.log("✅ Cancellation removed - subscription will continue current billing cycle");
    }

    // Update the family record in Supabase to reflect reactivation
    let updateData: any;
    
    if (family.subscription_status === "canceled") {
      // For canceled subscriptions, update all subscription details since we created a new one
      updateData = {
        stripe_subscription_id: reactivatedSubscription.id,
        subscription_canceled_at: null,
        subscription_status: "active",
        // Note: Current period dates and payment history will be updated by webhook
      };
    } else {
      // For canceling subscriptions, only clear the cancellation - preserve all existing data
      updateData = {
        subscription_canceled_at: null,
        subscription_status: "active",
        // Preserve: subscription_current_period_start, subscription_current_period_end, 
        // last_payment_at, trial_ends_at, etc. - all existing subscription data stays intact
      };
    }

    console.log("📊 Updating family record:", {
      familyId: family.id,
      updateType: family.subscription_status === "canceled" ? "new_subscription_data" : "remove_cancellation_only",
      fieldsUpdated: Object.keys(updateData)
    });

    const { error: updateError } = await supabase
      .from("families")
      .update(updateData)
      .eq("id", family.id);

    if (updateError) {
      console.error("Error updating family record:", updateError);
      // Continue anyway since Stripe was updated
    } else {
      console.log("✅ Family record updated successfully");
    }

    // Handle response based on the type of reactivation
    let clientSecret = null;
    let requiresPayment = false;
    let reactivationType = family.subscription_status === "canceled" ? "new_subscription" : "remove_cancellation";
    
    if (family.subscription_status === "canceled") {
      // For canceled subscriptions that required new subscription creation
      // Handle latest_invoice expansion
      if (reactivatedSubscription.latest_invoice && typeof reactivatedSubscription.latest_invoice === "object") {
        const invoice = reactivatedSubscription.latest_invoice as any;
        if (invoice.payment_intent && typeof invoice.payment_intent === "object") {
          clientSecret = invoice.payment_intent.client_secret;
          requiresPayment = invoice.payment_intent.status !== "succeeded";
        }
      }

      // Handle pending_setup_intent expansion  
      if (!clientSecret && reactivatedSubscription.pending_setup_intent && typeof reactivatedSubscription.pending_setup_intent === "object") {
        const setupIntent = reactivatedSubscription.pending_setup_intent as any;
        clientSecret = setupIntent.client_secret;
        requiresPayment = true;
      }
      
      // If no client secret is needed, payment was successful
      if (!clientSecret && reactivatedSubscription.status === "active") {
        requiresPayment = false;
      } else if (!clientSecret) {
        requiresPayment = true;
      }
    } else {
      // For canceling subscriptions, no payment is needed - just continue existing billing cycle
      requiresPayment = false;
      clientSecret = null;
    }

    const getMessage = () => {
      if (reactivationType === "remove_cancellation") {
        return "Subscription reactivated successfully - billing will continue on your current cycle";
      } else if (requiresPayment) {
        return "Subscription reactivated - payment confirmation required";
      } else {
        return "Subscription reactivated successfully with saved payment method";
      }
    };

    return {
      success: true,
      message: getMessage(),
      subscription: {
        id: reactivatedSubscription.id,
        status: reactivatedSubscription.status,
        cancel_at_period_end: reactivatedSubscription.cancel_at_period_end,
        current_period_end: (reactivatedSubscription as any).current_period_end,
      },
      clientSecret, // Only for canceled subscriptions that need payment setup
      requiresPayment,
      reactivationType, // "remove_cancellation" or "new_subscription" 
      paymentMethod: requiresPayment ? "setup_required" : (reactivationType === "remove_cancellation" ? "existing_cycle" : "default_used"),
    };
  } catch (error) {
    console.error("Subscription reactivation error:", error);
    return {
      success: false,
      error: "Failed to reactivate subscription",
      status: 500,
    };
  }
}

export async function resubscribe(family: any): Promise<StripeResult> {
  try {
    const supabase = createServerSupabase();

    // Check if user already has an active subscription
    if (family.stripe_subscription_id) {
      try {
        const existingSubscription = await stripe.subscriptions.retrieve(
          family.stripe_subscription_id
        );

        if (
          existingSubscription.status === "active" ||
          existingSubscription.status === "trialing"
        ) {
          return {
            success: false,
            error: "You already have an active subscription",
            status: 400,
          };
        }
      } catch (error) {
        // Subscription doesn't exist in Stripe, continue with resubscription
        console.log(
          "Previous subscription not found in Stripe, continuing with resubscription"
        );
      }
    }

    console.log(
      "Creating resubscription for existing user:",
      family.parent_email
    );

    // Ensure Stripe product and price exist
    const { price } = await ensureProductAndPrice();

    // Get or create Stripe customer
    const customer = await createOrRetrieveCustomer(
      family.parent_email,
      family.parent_name
    );

    // Clear any previous metadata to avoid confusion with new user creation
    await stripe.customers.update(customer.id, {
      metadata: {
        platform: "heart-harbor",
        resubscription: "true",
        family_id: family.id.toString(),
      },
    });

    // Create new subscription with trial (since it's a returning customer, we can be generous)
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_period_days: 7, // Give returning customers a 7-day trial
      expand: ["latest_invoice", "pending_setup_intent"],
    });

    console.log(
      "Stripe subscription created for resubscription:",
      subscription.id
    );

    // Update the family record with new subscription details
    const { error: updateError } = await supabase
      .from("families")
      .update({
        stripe_subscription_id: subscription.id,
        stripe_customer_id: customer.id,
        subscription_status:
          subscription.status === "trialing"
            ? "trial"
            : subscription.status === "active"
            ? "active"
            : "inactive",
        trial_ends_at: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
        subscription_canceled_at: null, // Clear previous cancellation
        subscription_current_period_start: (subscription as any)
          .current_period_start
          ? new Date(
              (subscription as any).current_period_start * 1000
            ).toISOString()
          : null,
        subscription_current_period_end: (subscription as any)
          .current_period_end
          ? new Date(
              (subscription as any).current_period_end * 1000
            ).toISOString()
          : null,
        last_payment_at: null, // Will be set when payment succeeds
        last_payment_failed_at: null, // Clear any previous payment failures
      })
      .eq("id", family.id);

    if (updateError) {
      console.error(
        "Error updating family with new subscription:",
        updateError
      );

      // Try to cancel the Stripe subscription if we couldn't update the database
      try {
        await stripe.subscriptions.cancel(subscription.id);
      } catch (cancelError) {
        console.error(
          "Error canceling Stripe subscription after database update failure:",
          cancelError
        );
      }

      return {
        success: false,
        error: "Failed to update subscription in database",
        status: 500,
      };
    }

    // Get client secret for payment setup
    let clientSecret = null;

    // Handle latest_invoice expansion
    if (
      subscription.latest_invoice &&
      typeof subscription.latest_invoice === "object"
    ) {
      const invoice = subscription.latest_invoice as any;
      if (
        invoice.payment_intent &&
        typeof invoice.payment_intent === "object"
      ) {
        clientSecret = invoice.payment_intent.client_secret;
      }
    }

    // Handle pending_setup_intent expansion
    if (
      !clientSecret &&
      subscription.pending_setup_intent &&
      typeof subscription.pending_setup_intent === "object"
    ) {
      const setupIntent = subscription.pending_setup_intent as any;
      clientSecret = setupIntent.client_secret;
    }

    return {
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      clientSecret,
      trialEnd: subscription.trial_end,
      status_stripe: subscription.status,
      message: "Subscription reactivated successfully!",
    };
  } catch (error) {
    console.error("Resubscription error:", error);
    return {
      success: false,
      error: "Failed to reactivate subscription",
      status: 500,
    };
  }
}

export async function handleWebhook(
  body: any,
  signature: string
): Promise<StripeResult> {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return {
        success: false,
        error: "Webhook secret not configured",
        status: 500,
      };
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return {
        success: false,
        error: "Invalid signature",
        status: 400,
      };
    }

    // Handle the event
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionEvent(event);
        break;
      case "invoice.payment_succeeded":
        await handlePaymentSucceeded(event);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Webhook handler error:", error);
    return {
      success: false,
      error: "Webhook processing failed",
      status: 500,
    };
  }
}

// Helper function to handle subscription events
async function handleSubscriptionEvent(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const supabase = createServerSupabase();

  // Update family subscription status based on Stripe subscription
  const { error } = await supabase
    .from("families")
    .update({
      subscription_status: subscription.status,
      stripe_subscription_id: subscription.id,
      subscription_current_period_start: (subscription as any).current_period_start ? new Date(
        (subscription as any).current_period_start * 1000
      ).toISOString() : null,
      subscription_current_period_end: (subscription as any).current_period_end ? new Date(
        (subscription as any).current_period_end * 1000
      ).toISOString() : null,
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    })
    .eq("stripe_customer_id", subscription.customer);

  if (error) {
    console.error("Error updating family subscription status:", error);
  }
}

// Helper function to handle successful payments
async function handlePaymentSucceeded(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const supabase = createServerSupabase();

  // Update family last payment info
  const { error } = await supabase
    .from("families")
    .update({
      last_payment_at: new Date().toISOString(),
      subscription_status: "active",
    })
    .eq("stripe_customer_id", invoice.customer);

  if (error) {
    console.error("Error updating family payment status:", error);
  }
}

// Helper function to handle failed payments
async function handlePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  console.log(`Payment failed for customer: ${invoice.customer}`);

  // Could implement retry logic or notifications here
}

export async function testStripe(): Promise<any> {
  try {
    // Test Stripe connection by listing products
    const products = await stripe.products.list({ limit: 1 });

    return {
      stripeConnected: true,
      apiVersion: "2025-06-30.basil",
      productsCount: products.data.length,
    };
  } catch (error) {
    console.error("Stripe test error:", error);
    throw error;
  }
}
