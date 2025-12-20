// ============================================================================
// AMATUEDDA CENTRALIZED PAYMENT API
// Single payment hub for ALL products in the ecosystem
// ============================================================================

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ============================================================================
// PRODUCT REGISTRY
// All products that can be purchased through AmatuEdda
// ============================================================================

const PRODUCT_REGISTRY = {
  // Scout-Faire Credits
  'scout_faire_starter': {
    name: 'Scout-Faire Starter',
    credits: 10,
    price_cents: 900,
    stripe_price_id: process.env.STRIPE_PRICE_SCOUT_STARTER,
    table: 'scout_faire_transactions',
    bonuses: [] // No bonuses for Scout-Faire credits
  },
  'scout_faire_pro': {
    name: 'Scout-Faire Pro',
    credits: 50,
    price_cents: 3900,
    stripe_price_id: process.env.STRIPE_PRICE_SCOUT_PRO,
    table: 'scout_faire_transactions',
    bonuses: []
  },
  'scout_faire_business': {
    name: 'Scout-Faire Business',
    credits: 200,
    price_cents: 12900,
    stripe_price_id: process.env.STRIPE_PRICE_SCOUT_BUSINESS,
    table: 'scout_faire_transactions',
    bonuses: []
  },
  
  // Systasis Products
  'systasis': {
    name: 'Systasis Pro',
    price_cents: 4700,
    stripe_price_id: process.env.STRIPE_PRICE_SYSTASIS,
    table: 'systasis_orders',
    bonuses: ['agentdeck_pro', 'two_brothers_engineer', 'api_magic_vault']
  },
  'chronos': {
    name: 'Chronos Elite',
    price_cents: 3700,
    stripe_price_id: process.env.STRIPE_PRICE_CHRONOS,
    table: 'systasis_orders',
    bonuses: ['two_brothers_engineer', 'api_magic_vault']
  },
  'nexus': {
    name: 'Nexus Bundle',
    price_cents: 9700,
    stripe_price_id: process.env.STRIPE_PRICE_NEXUS,
    table: 'systasis_orders',
    bonuses: ['agentdeck_pro', 'two_brothers_engineer', 'api_magic_vault']
  },
  
  // Trail-Maker Products (dynamically generated)
  // Format: trail_maker_{forge_run_id}_{tier}
  // Will be registered when Trail-Maker creates funnel
};

// ============================================================================
// POST /api/payments/create-checkout
// Universal checkout creator for ALL products
// ============================================================================

router.post('/create-checkout', async (req, res) => {
  try {
    const {
      productId,        // 'scout_faire_pro', 'systasis', 'trail_maker_xxx_fe'
      userId,           // Optional: authenticated user
      email,            // Required: customer email
      affiliateId,      // Optional: affiliate tracking
      successUrl,       // Where to redirect after success
      cancelUrl,        // Where to redirect if cancelled
      metadata          // Optional: extra data
    } = req.body;
    
    // Validate product exists
    const product = PRODUCT_REGISTRY[productId];
    if (!product) {
      return res.status(400).json({
        success: false,
        error: `Unknown product: ${productId}`
      });
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: product.stripe_price_id,
          quantity: 1,
        }
      ],
      customer_email: email,
       ...(userId && { client_reference_id: userId }),
      success_url: successUrl || `${process.env.SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.SITE_URL}/checkout`,
      metadata: {
        product_id: productId,
        user_id: userId || 'guest',
        affiliate_id: affiliateId || 'DIRECT',
        product_table: product.table,
        ...metadata
      }
    });
    
    res.json({
      success: true,
      sessionId: session.id,
      sessionUrl: session.url
    });
    
  } catch (error) {
    console.error('Checkout creation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// POST /api/payments/webhook
// Single webhook handler for ALL products
// ============================================================================

router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
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
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;
      
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;
      
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
      
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  res.json({ received: true });
});

// ============================================================================
// CHECKOUT COMPLETION HANDLER
// Routes to appropriate product handler based on product_table
// ============================================================================

async function handleCheckoutCompleted(session) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { product_id, product_table, user_id, affiliate_id } = session.metadata;
    const product = PRODUCT_REGISTRY[product_id];
    
    console.log(`Processing order for ${product_id} → ${product_table}`);
    
    // Route to appropriate handler
    switch (product_table) {
      case 'scout_faire_transactions':
        await handleScoutFairePurchase(client, session, product);
        break;
        
      case 'systasis_orders':
        await handleSystasisPurchase(client, session, product);
        break;
        
      case 'trail_maker_orders':
        await handleTrailMakerPurchase(client, session, product);
        break;
        
      default:
        throw new Error(`Unknown product table: ${product_table}`);
    }
    
    await client.query('COMMIT');
    console.log(`✓ Order processed successfully for ${product_id}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Order processing failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// SCOUT-FAIRE PURCHASE HANDLER
// ============================================================================

async function handleScoutFairePurchase(client, session, product) {
  const userId = session.client_reference_id;
  const email = session.customer_email;
  
  // Use existing Scout-Faire function
  await client.query(
    'SELECT process_scout_faire_purchase($1, $2, $3, $4, $5)',
    [
      userId,
      session.id,
      product.name,
      product.credits,
      session.amount_total
    ]
  );
  
  console.log(`✓ Added ${product.credits} credits to user ${userId}`);
}

// ============================================================================
// SYSTASIS PURCHASE HANDLER
// ============================================================================

async function handleSystasisPurchase(client, session, product) {
  const userId = session.client_reference_id;
  const email = session.customer_email;
  const affiliateId = session.metadata.affiliate_id || 'DIRECT';
  
  // 1. Create order
  const orderResult = await client.query(`
    INSERT INTO systasis_orders (
      user_id,
      order_number,
      items,
      subtotal_cents,
      total_cents,
      affiliate_id,
      customer_email,
      payment_provider,
      payment_intent_id,
      payment_status,
      order_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'stripe', $8, 'completed', 'completed')
    RETURNING id
  `, [
    userId,
    generateOrderNumber(),
    JSON.stringify([{ product_id: session.metadata.product_id, quantity: 1 }]),
    session.amount_total,
    session.amount_total,
    affiliateId,
    email,
    session.payment_intent
  ]);
  
  const orderId = orderResult.rows[0].id;
  
  // 2. Grant bonuses
  const bonusResult = await client.query(
    'SELECT * FROM grant_bonuses_for_order($1, $2, $3, $4)',
    [orderId, userId, email, session.metadata.product_id]
  );
  
  console.log(`✓ Order ${orderId} created with ${bonusResult.rowCount} bonuses`);
  
  // 3. Calculate affiliate commission (30%)
  if (affiliateId !== 'DIRECT') {
    const commissionCents = Math.floor(session.amount_total * 0.30);
    
    await client.query(`
      UPDATE systasis_orders
      SET affiliate_commission_cents = $1
      WHERE id = $2
    `, [commissionCents, orderId]);
    
    console.log(`✓ Affiliate ${affiliateId} commission: $${commissionCents / 100}`);
  }
  
  // 4. Send email with bonuses
  await sendBonusDeliveryEmail(email, orderId, bonusResult.rows);
}

// ============================================================================
// TRAIL-MAKER PURCHASE HANDLER
// ============================================================================

async function handleTrailMakerPurchase(client, session, product) {
  const userId = session.client_reference_id;
  const email = session.customer_email;
  const { forge_run_id, tier } = session.metadata;
  
  // Create Trail-Maker order
  await client.query(`
    INSERT INTO trail_maker_orders (
      user_id,
      forge_run_id,
      funnel_tier,
      order_number,
      amount_cents,
      customer_email,
      payment_intent_id,
      order_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')
  `, [
    userId,
    forge_run_id,
    tier,
    generateOrderNumber(),
    session.amount_total,
    email,
    session.payment_intent
  ]);
  
  console.log(`✓ Trail-Maker order for ${tier} tier`);
}

// ============================================================================
// PAYMENT SUCCESS/FAILURE HANDLERS
// ============================================================================

async function handlePaymentSuccess(paymentIntent) {
  console.log(`✓ Payment succeeded: ${paymentIntent.id}`);
  // Additional success tracking if needed
}

async function handlePaymentFailed(paymentIntent) {
  console.error(`✗ Payment failed: ${paymentIntent.id}`);
  // Log failure, notify user, etc.
}

// ============================================================================
// EMAIL NOTIFICATION
// ============================================================================

async function sendBonusDeliveryEmail(email, orderId, bonuses) {
  if (bonuses.length === 0) return;
  
  const totalValue = bonuses.reduce((sum, b) => {
    const product = PRODUCT_REGISTRY[b.granted_via_product];
    return sum + (product?.bonuses?.length || 0) * 100; // Rough estimate
  }, 0);
  
  console.log(`📧 Sending bonus delivery email to ${email}`);
  console.log(`   Order: ${orderId}`);
  console.log(`   Bonuses: ${bonuses.length}`);
  console.log(`   Value: $${totalValue}`);
  
  // TODO: Integrate with your email service (SendGrid, Mailgun, etc.)
  // See bonus-api-routes.js for email template
}

// ============================================================================
// REGISTER DYNAMIC PRODUCT (for Trail-Maker)
// ============================================================================

router.post('/register-product', async (req, res) => {
  try {
    const {
      productId,      // 'trail_maker_xxx_fe'
      name,           // 'AI Sleep Tracker - Frontend'
      priceCents,     // 1700
      stripePriceId,  // price_xxx from Stripe
      table,          // 'trail_maker_orders'
      metadata        // { forge_run_id, tier }
    } = req.body;
    
    // Register in PRODUCT_REGISTRY
    PRODUCT_REGISTRY[productId] = {
      name,
      price_cents: priceCents,
      stripe_price_id: stripePriceId,
      table,
      bonuses: [], // Trail-Maker products don't get bonuses (yet)
      metadata
    };
    
    console.log(`✓ Registered product: ${productId}`);
    
    res.json({
      success: true,
      productId
    });
    
  } catch (error) {
    console.error('Product registration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// GET /api/payments/success
// Universal success page data
// ============================================================================

router.get('/success', async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({
        success: false,
        error: 'No session ID provided'
      });
    }
    
    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    const product = PRODUCT_REGISTRY[session.metadata.product_id];
    
    res.json({
      success: true,
      order: {
        product_name: product.name,
        amount_paid: session.amount_total / 100,
        customer_email: session.customer_email,
        has_bonuses: product.bonuses.length > 0,
        bonus_count: product.bonuses.length
      }
    });
    
  } catch (error) {
    console.error('Success page data fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;
module.exports.PRODUCT_REGISTRY = PRODUCT_REGISTRY;
