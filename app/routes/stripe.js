// routes/stripe.js
// Complete Stripe webhook handler for Scout-Faire subscription management

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service_role key for admin operations
);

// Price ID to tier mapping
const PRICE_TIER_MAP = {
  'price_1SkczEGoRkUwNcvtGT0rbyvN': 'pro',        // $19.99/month
  'price_1Skd2DGoRkUwNcvt5t08bSNk': 'enterprise'  // $99.99/month
};

// Tier search limits
const TIER_LIMITS = {
  'free': 5,
  'pro': 999999,      // Unlimited
  'enterprise': 999999 // Unlimited + business models
};

/**
 * Main webhook endpoint - receives all Stripe events
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Received event:', event.type);

  // Handle the event
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle subscription created or updated
 */
async function handleSubscriptionChange(subscription) {
  const customerId = subscription.customer;
  const subscriptionId = subscription.id;
  const priceId = subscription.items.data[0].price.id;
  const status = subscription.status;

  // Get customer email from Stripe
  const customer = await stripe.customers.retrieve(customerId);
  const email = customer.email;

  // Determine tier from price ID
  const tier = PRICE_TIER_MAP[priceId] || 'free';
  const searchLimit = TIER_LIMITS[tier];

  console.log(`📝 Subscription ${status} for ${email} → ${tier} tier`);

  // Check if user exists
  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (existingUser) {
    // Update existing user
    const { error } = await supabase
      .from('users')
      .update({
        tier: tier,
        search_limit: searchLimit,
        searches_used_this_month: 0, // Reset on tier change
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        period_start: new Date().toISOString(),
        last_active: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('email', email);

    if (error) {
      console.error('Error updating user:', error);
      throw error;
    }

    console.log(`✅ Updated user ${email} to ${tier} tier`);
  } else {
    // Create new user
    const { error } = await supabase
      .from('users')
      .insert({
        email: email,
        tier: tier,
        search_limit: searchLimit,
        searches_used_this_month: 0,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        period_start: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active: new Date().toISOString()
      });

    if (error) {
      console.error('Error creating user:', error);
      throw error;
    }

    console.log(`✅ Created new user ${email} with ${tier} tier`);
  }
}

/**
 * Handle subscription canceled
 */
async function handleSubscriptionCanceled(subscription) {
  const subscriptionId = subscription.id;

  console.log(`❌ Subscription canceled: ${subscriptionId}`);

  // Downgrade to free tier
  const { error } = await supabase
    .from('users')
    .update({
      tier: 'free',
      search_limit: TIER_LIMITS.free,
      searches_used_this_month: 0,
      stripe_subscription_id: null,
      period_start: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscriptionId);

  if (error) {
    console.error('Error downgrading user:', error);
    throw error;
  }

  console.log(`✅ User downgraded to free tier`);
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  console.log(`💰 Payment succeeded for subscription ${subscriptionId}`);

  // Reset monthly search count on successful payment
  const { error } = await supabase
    .from('users')
    .update({
      searches_used_this_month: 0,
      period_start: new Date().toISOString(),
      last_active: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscriptionId);

  if (error) {
    console.error('Error resetting search count:', error);
    throw error;
  }

  console.log(`✅ Search count reset for renewal period`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;
  const subscriptionId = invoice.subscription;

  console.log(`⚠️ Payment failed for subscription ${subscriptionId}`);

  // Optionally: Send notification, flag account, etc.
  // For now, just log it - Stripe will retry automatically
}

/**
 * Handle checkout session completed
 */
async function handleCheckoutCompleted(session) {
  const customerId = session.customer;
  const email = session.customer_email || session.customer_details?.email;
  const subscriptionId = session.subscription;

  console.log(`🎉 Checkout completed for ${email}`);

  // The subscription.created event will handle the actual user update
  // This is just for logging/analytics
}

/**
 * Health check endpoint
 */
router.get('/stripe/health', (req, res) => {
  res.json({ 
    status: 'ok',
    webhook: 'active',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
