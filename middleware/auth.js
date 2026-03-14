const bcrypt = require('bcryptjs');

/**
 * Admin password authentication middleware.
 *
 * Expects: Authorization: Bearer <admin-token>
 * The token is compared against ADMIN_PASSWORD_HASH env var (bcrypt hash).
 *
 * Set up:
 *   1. Run `npm run hash-password` to generate a hash for your chosen password
 *   2. Add ADMIN_PASSWORD_HASH=<generated-hash> to your .env file
 *   3. Clients send the plain password as the Bearer token
 */
const requireAdmin = async (req, res, next) => {
  const hash = process.env.ADMIN_PASSWORD_HASH;

  // If no hash is configured, admin auth is disabled (development convenience)
  if (!hash) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7); // strip "Bearer "
  try {
    const valid = await bcrypt.compare(token, hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    next();
  } catch {
    res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = requireAdmin;
