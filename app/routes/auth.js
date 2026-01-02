// routes/auth.js
// Authentication routes for Scout-Faire free tier signup and login

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const SALT_ROUNDS = 10;

/**
 * POST /signup
 * Create new free tier user account
 * (Mounted at /api/auth, so full path is /api/auth/signup)
 */
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.json({
      success: false,
      error: 'Email and password are required'
    });
  }

  if (password.length < 8) {
    return res.json({
      success: false,
      error: 'Password must be at least 8 characters'
    });
  }

  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.json({
        success: false,
        error: 'An account with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user in Supabase
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        tier: 'free',
        searches_used_this_month: 0,
        search_limit: 5,
        period_start: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        password_hash: passwordHash
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error creating user:', error);
      throw error;
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: newUser.id, 
        email: newUser.email,
        tier: newUser.tier
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ New free user created: ${email}`);

    res.json({
      success: true,
      token: token,
      user: {
        id: newUser.id,
        email: newUser.email,
        tier: newUser.tier,
        searches_remaining: newUser.search_limit - newUser.searches_used_this_month
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.json({
      success: false,
      error: 'Failed to create account. Please try again.'
    });
  }
});

/**
 * POST /login
 * Login existing user
 * (Mounted at /api/auth, so full path is /api/auth/login)
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.json({
      success: false,
      error: 'Email and password are required'
    });
  }

  try {
    // Get user from database
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last active
    await supabase
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('id', user.id);

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        tier: user.tier
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ User logged in: ${email}`);

    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        searches_remaining: user.search_limit - user.searches_used_this_month
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

/**
 * GET /me
 * Get current user info (requires auth token)
 * (Mounted at /api/auth, so full path is /api/auth/me)
 */
router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.json({
      success: false,
      error: 'No authentication token provided'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get fresh user data
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, tier, searches_used_this_month, search_limit, period_start')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if we need to reset monthly search count
    const periodStart = new Date(user.period_start);
    const now = new Date();
    const daysSincePeriodStart = (now - periodStart) / (1000 * 60 * 60 * 24);

    if (daysSincePeriodStart >= 30) {
      // Reset monthly searches
      await supabase
        .from('users')
        .update({
          searches_used_this_month: 0,
          period_start: now.toISOString()
        })
        .eq('id', user.id);

      user.searches_used_this_month = 0;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        searches_remaining: user.search_limit - user.searches_used_this_month,
        searches_used: user.searches_used_this_month,
        search_limit: user.search_limit
      }
    });

  } catch (error) {
    console.error('Auth verification error:', error);
    res.json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
});

module.exports = router;
