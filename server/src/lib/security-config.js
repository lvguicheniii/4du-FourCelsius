const configuredJwtSecret = String(process.env.JWT_SECRET || '');

if (process.env.NODE_ENV === 'production' && configuredJwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
}

module.exports = {
  JWT_SECRET: configuredJwtSecret || '4du-dev-secret',
};
