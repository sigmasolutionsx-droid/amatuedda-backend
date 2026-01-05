// backend/app/middleware/auth.js
// Authentication middleware for SkyPath routes

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Verify JWT token and attach user to request
 */
async function authenticateUser(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No authorization token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') { // Ignore not found
      console.error('Profile fetch error:', profileError);
    }

    // Attach user and profile to request
    req.user = {
      id: data.user.id,
      email: data.user.email,
      ...profile
    };

    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

/**
 * Check if user has required tier access
 */
function requireTier(requiredTier) {
  const tierLevels = { starter: 1, pro: 2, enterprise: 3 };

  return (req, res, next) => {
    const userTier = req.user?.license_tier || 'starter';
    const userLevel = tierLevels[userTier] || 0;
    const requiredLevel = tierLevels[requiredTier] || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        error: `This feature requires ${requiredTier} tier or higher`,
        current_tier: userTier,
        required_tier: requiredTier
      });
    }

    next();
  };
}

/**
 * Check if user's license is active
 */
function requireActiveLicense(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (req.user.license_status !== 'active') {
    return res.status(403).json({
      success: false,
      error: 'License inactive',
      status: req.user.license_status
    });
  }

  // Check expiration
  if (req.user.license_expires_at) {
    const expiry = new Date(req.user.license_expires_at);
    if (expiry < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'License expired',
        expired_at: req.user.license_expires_at
      });
    }
  }

  next();
}

module.exports = {
  authenticateUser,
  requireTier,
  requireActiveLicense
};
