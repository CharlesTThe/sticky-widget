// Standalone server — used for the demo and local dev.
// In production, consumers mount stickyRouter() in their own Express app.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { stickyRouter } = require('./router');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('[sticky-widget] Idle pool client error:', err.message));

const app = express();

// Security headers
app.use(helmet());

// Body size limit
app.use(express.json({ limit: '16kb' }));

// CORS — require explicit origin, no wildcard fallback
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin) {
  console.warn('[sticky-widget] WARNING: CORS_ORIGIN not set. Defaulting to * (not recommended for production).');
}
app.use(cors({ origin: corsOrigin || '*' }));

// Rate limiting — 30 requests per minute per IP
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/v1', rateLimiter);

app.use('/api/v1', stickyRouter(pool));

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`Sticky widget server running on port ${PORT}`));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[sticky-widget] Shutting down...');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
