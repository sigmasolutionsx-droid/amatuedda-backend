const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

/**
 * Require valid JWT token — attaches decoded user to req.user
 */
function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = {
            id: decoded.userId,
            email: decoded.email,
            tier: decoded.tier,
            is_admin: decoded.is_admin || false,
        };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
    if (!req.user?.is_admin) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

/**
 * Optional auth — attaches user if token present, continues either way
 */
function optionalAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = {
                id: decoded.userId,
                email: decoded.email,
                tier: decoded.tier,
                is_admin: decoded.is_admin || false,
            };
        } catch {}
    }
    next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth };
