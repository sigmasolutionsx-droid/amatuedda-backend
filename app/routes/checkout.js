// routes/checkout.js
// Stripe Checkout Session creation endpoint

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Price ID mapping
const PRICE_IDS = {
  'pro': 'price_1SkczEGoRkUwNcvtGT0rbyvN',        // $19.99/month
  'enterprise': 'price_1Skd2DGoRkUwNcvt5t08bSNk'  // $99.99/month
};

/**
 * Create Stripe Checkout Session
 * Matches pricing.html endpoint: /api/checkout/create-checkout-session
 */
router.post('/api/checkout/create-checkout-session', async (req, res) => {
  const { tier } = req.body;

  if (!tier) {
    return res.json({ 
      success: false, 
      error: 'Tier is required' 
    });
  }

  const priceId = PRICE_IDS[tier];
  
  if (!priceId) {
    return res.json({ 
      success: false, 
      error: 'Invalid tier selected' 
    });
  }

  try {
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing.html`,
      metadata: {
        tier: tier
      },
      allow_promotion_codes: true, // Allow discount codes
      billing_address_collection: 'auto',
    });

    // Return format matching pricing.html expectation
    res.json({ 
      success: true, 
      url: session.url 
    });
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.json({ 
      success: false,
      error: 'Failed to create checkout session',
      message: error.message 
    });
  }
});

module.exports = router;
