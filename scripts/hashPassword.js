/**
 * One-time script to generate a bcrypt hash for the admin password.
 *
 * Usage:
 *   node scripts/hashPassword.js <your-password>
 *
 * Copy the output hash into your .env file as ADMIN_PASSWORD_HASH=<hash>
 */
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hashPassword.js <password>');
  process.exit(1);
}

bcrypt.hash(password, 12).then((hash) => {
  console.log('\nAdd this to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
});
