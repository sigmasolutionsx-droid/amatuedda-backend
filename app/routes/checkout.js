const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create checkout session for Pro or Enterprise subscription
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { tier, email } = req.body;
    
    // Validate tier
    if (!tier || !['pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid tier. Must be "pro" or "enterprise"' 
      });
    }
    
    // Get price IDs from environment
    const priceIds = {
      pro: process.env.STRIPE_PRICE_PRO,
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE
    };
    
    const priceId = priceIds[tier];
    
    if (!priceId) {
      return res.status(500).json({ 
        success: false, 
        error: `Price ID not configured for ${tier} tier` 
      });
    }
    
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      success_url: `https://httpstat.us/200?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://httpstat.us/200`,
      customer_email: email, // Optional: pre-fill email if provided
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      metadata: {
        tier: tier
      }
    });
    
    res.json({ 
      success: true,
      url: session.url,
      session_id: session.id
    });
    
  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create checkout session' 
    });
  }
});

// Webhook handler for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  const supabase = req.app.locals.supabase;
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      
      // Get or create user
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('email', session.customer_email)
        .single();
      
      if (user) {
        // Update user tier
        const tier = session.metadata.tier || 'pro';
        
        await supabase
          .from('users')
          .update({
            tier: tier,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription
          })
          .eq('id', user.id);
          
        console.log(`User ${user.email} upgraded to ${tier}`);
      } else {
        // Create new user with Pro/Enterprise tier
        await supabase
          .from('users')
          .insert({
            email: session.customer_email,
            tier: session.metadata.tier || 'pro',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            searches_used_this_month: 0,
            search_limit: 999999 // Unlimited for paid tiers
          });
          
        console.log(`New user ${session.customer_email} created with ${session.metadata.tier}`);
      }
      
      break;
      
    case 'customer.subscription.updated':
      const subscription = event.data.object;
      
      // Update subscription status
      await supabase
        .from('users')
        .update({
          // Could track subscription status here
        })
        .eq('stripe_subscription_id', subscription.id);
        
      break;
      
    case 'customer.subscription.deleted':
      const deletedSub = event.data.object;
      
      // Downgrade to free tier
      await supabase
        .from('users')
        .update({
          tier: 'free',
          search_limit: 5,
          stripe_subscription_id: null
        })
        .eq('stripe_subscription_id', deletedSub.id);
        
      console.log(`Subscription ${deletedSub.id} cancelled, user downgraded to free`);
      
      break;
      
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
  
  res.json({ received: true });
});

module.exports = router;
