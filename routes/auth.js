// ============================================================================
// AUTH ROUTES
// Handles user authentication (signup, login, logout)
// ============================================================================

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

// ============================================================================
// POST /api/auth/signup
// Create new user account
// ============================================================================

router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters'
      });
    }
    
    const supabase = req.app.locals.supabase;
    
    // Check if user already exists
    const { data: existing } = await supabase
      .from('amatuedda_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Create user
    const { data: user, error } = await supabase
      .from('amatuedda_users')
      .insert({
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: name || email.split('@')[0],
        email_verified: false
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Generate JWT
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      token
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account'
    });
  }
});

// ============================================================================
// POST /api/auth/login
// Login existing user
// ============================================================================

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    const supabase = req.app.locals.supabase;
    
    // Get user
    const { data: user, error } = await supabase
      .from('amatuedda_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();
    
    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    // Update last login
    await supabase
      .from('amatuedda_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);
    
    // Generate JWT
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        isAdmin: user.is_admin || false
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin || false
      },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login'
    });
  }
});

// ============================================================================
// GET /api/auth/me
// Get current user (requires auth)
// ============================================================================

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const supabase = req.app.locals.supabase;
    
    // Get user
    const { data: user, error } = await supabase
      .from('amatuedda_users')
      .select('id, email, name, is_admin, created_at')
      .eq('id', decoded.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user'
    });
  }
});

// ============================================================================
// MIDDLEWARE: Require authentication
// ============================================================================

const requireAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const supabase = req.app.locals.supabase;
    
    const { data: user, error } = await supabase
      .from('amatuedda_users')
      .select('id, email, name, is_admin')
      .eq('id', decoded.userId)
      .single();
    
    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication'
      });
    }
    
    req.user = user;
    next();
    
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};

module.exports = router;
module.exports.requireAuth = requireAuth;
