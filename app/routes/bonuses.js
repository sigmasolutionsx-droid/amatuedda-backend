// ============================================================================
// BONUS DELIVERY API ROUTES
// Backend integration for free bonus system
// ============================================================================

const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ============================================================================
// GET /api/bonuses/my-bonuses
// Get all bonuses for the authenticated user
// ============================================================================

router.get('/my-bonuses', async (req, res) => {
  try {
    const userId = req.user.id; // Assuming auth middleware sets req.user
    
    const result = await pool.query(`
      SELECT * FROM v_user_bonuses
      WHERE user_id = $1
      ORDER BY granted_at DESC
    `, [userId]);
    
    res.json({
      success: true,
      bonuses: result.rows
    });
  } catch (error) {
    console.error('Error fetching bonuses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bonuses'
    });
  }
});

// ============================================================================
// POST /api/bonuses/track-download
// Track when a user downloads/accesses a bonus
// ============================================================================

router.post('/track-download', async (req, res) => {
  try {
    const { accessKey, downloadType } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.get('user-agent');
    
    // Track the download
    const result = await pool.query(
      'SELECT track_bonus_download($1, $2, $3, $4) as success',
      [accessKey, downloadType, ipAddress, userAgent]
    );
    
    if (result.rows[0].success) {
      res.json({
        success: true,
        message: 'Download tracked'
      });
    } else {
      res.status(403).json({
        success: false,
        error: 'Invalid or expired access key'
      });
    }
  } catch (error) {
    console.error('Error tracking download:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track download'
    });
  }
});

// ============================================================================
// POST /api/bonuses/redeem-code
// Redeem a bonus access code
// ============================================================================

router.post('/redeem-code', async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;
    const ipAddress = req.ip;
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Check if code is valid
      const codeCheck = await client.query(`
        SELECT bak.*, bp.name, bp.bonus_key
        FROM bonus_access_keys bak
        JOIN bonus_products bp ON bp.id = bak.bonus_id
        WHERE bak.access_code = $1
        AND bak.is_active = true
        AND bak.current_redemptions < bak.max_redemptions
        AND (bak.expires_at IS NULL OR bak.expires_at > NOW())
      `, [code]);
      
      if (codeCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Invalid, expired, or fully redeemed code'
        });
      }
      
      const accessKey = codeCheck.rows[0];
      
      // Grant access to user
      const accessKeyStr = require('crypto').randomBytes(16).toString('hex');
      
      await client.query(`
        INSERT INTO user_bonus_access (
          user_id,
          email,
          bonus_id,
          access_key
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, bonus_id) DO NOTHING
      `, [
        userId,
        req.user.email,
        accessKey.bonus_id,
        accessKeyStr
      ]);
      
      // Update redemption count
      await client.query(`
        UPDATE bonus_access_keys
        SET current_redemptions = current_redemptions + 1,
            redeemed_by_user_id = $1,
            redeemed_at = NOW(),
            redemption_ip = $2
        WHERE access_code = $3
      `, [userId, ipAddress, code]);
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: `${accessKey.name} unlocked!`,
        bonus: {
          name: accessKey.name,
          bonus_key: accessKey.bonus_key
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error redeeming code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to redeem code'
    });
  }
});

// ============================================================================
// POST /api/bonuses/generate-code
// Generate a bonus access code (admin only)
// ============================================================================

router.post('/generate-code', async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    const { bonusId, maxRedemptions = 1, expiresDays = 30 } = req.body;
    
    const result = await pool.query(
      'SELECT generate_bonus_access_code($1, $2, $3) as code',
      [bonusId, maxRedemptions, expiresDays]
    );
    
    res.json({
      success: true,
      code: result.rows[0].code
    });
  } catch (error) {
    console.error('Error generating code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate code'
    });
  }
});

// ============================================================================
// WEBHOOK INTEGRATION
// Add this to your existing Stripe webhook handler
// ============================================================================

async function handleCheckoutCompleted(session) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Create the order (existing logic)
    const orderResult = await client.query(`
      INSERT INTO systasis_orders (
        user_id,
        order_number,
        items,
        total_cents,
        customer_email,
        affiliate_id,
        payment_intent_id,
        order_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')
      RETURNING id
    `, [
      session.client_reference_id,
      generateOrderNumber(),
      JSON.stringify(session.metadata.items),
      session.amount_total,
      session.customer_email,
      session.metadata.affiliate_id || 'DIRECT',
      session.payment_intent,
    ]);
    
    const orderId = orderResult.rows[0].id;
    
    // 2. Grant bonuses automatically!
    const items = JSON.parse(session.metadata.items);
    
    for (const item of items) {
      await client.query(
        'SELECT * FROM grant_bonuses_for_order($1, $2, $3, $4)',
        [
          orderId,
          session.client_reference_id,
          session.customer_email,
          item.product_id
        ]
      );
    }
    
    await client.query('COMMIT');
    
    // 3. Send email with bonus access
    await sendBonusDeliveryEmail(
      session.customer_email,
      orderId
    );
    
    return { success: true, orderId };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error handling checkout:', error);
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// EMAIL NOTIFICATION
// Send bonus delivery email
// ============================================================================

async function sendBonusDeliveryEmail(email, orderId) {
  try {
    // Get bonuses for this order
    const result = await pool.query(`
      SELECT 
        uba.access_key,
        bp.name,
        bp.access_url,
        bp.download_url,
        bp.retail_value_cents
      FROM user_bonus_access uba
      JOIN bonus_products bp ON bp.id = uba.bonus_id
      WHERE uba.granted_via_order_id = $1
    `, [orderId]);
    
    const bonuses = result.rows;
    
    if (bonuses.length === 0) {
      return; // No bonuses for this order
    }
    
    const totalValue = bonuses.reduce((sum, b) => sum + b.retail_value_cents, 0) / 100;
    
    // Email template
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f7f7f7; padding: 30px; }
          .bonus-card { background: white; border-left: 4px solid #667eea; padding: 20px; margin: 15px 0; border-radius: 5px; }
          .bonus-value { color: #27ae60; font-weight: bold; font-size: 18px; }
          .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 10px 0; font-weight: bold; }
          .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎁 Your Bonuses Are Ready!</h1>
            <p>Thank you for your purchase. Here's $${totalValue} in FREE bonuses!</p>
          </div>
          <div class="content">
            <p>Hi there!</p>
            <p>Your order is complete and your bonuses are ready to access. Here's what you got:</p>
            
            ${bonuses.map(bonus => `
              <div class="bonus-card">
                <h3>${bonus.name}</h3>
                <p class="bonus-value">$${(bonus.retail_value_cents / 100).toFixed(0)} Value</p>
                <p><strong>Access Key:</strong> <code>${bonus.access_key}</code></p>
                <a href="${bonus.access_url || bonus.download_url}" class="cta-button">
                  Access ${bonus.name} →
                </a>
              </div>
            `).join('')}
            
            <p style="margin-top: 30px;">
              <strong>Quick Access:</strong> Visit your bonus dashboard at:<br>
              <a href="${process.env.SITE_URL}/bonuses" class="cta-button">
                View All Bonuses
              </a>
            </p>
            
            <p style="margin-top: 30px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 5px;">
              💡 <strong>Pro Tip:</strong> Save your access keys somewhere safe. You can use them anytime to redownload your bonuses.
            </p>
          </div>
          <div class="footer">
            <p>Questions? Reply to this email or visit our support center.</p>
            <p>© ${new Date().getFullYear()} Freedom Uprise. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Send email (use your email service - SendGrid, Mailgun, etc.)
    // await sendEmail({
    //   to: email,
    //   subject: `🎁 Your $${totalValue} in Free Bonuses Are Ready!`,
    //   html: emailHtml
    // });
    
    console.log(`Bonus delivery email sent to ${email}`);
  } catch (error) {
    console.error('Error sending bonus email:', error);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

module.exports = router;
module.exports.handleCheckoutCompleted = handleCheckoutCompleted;
