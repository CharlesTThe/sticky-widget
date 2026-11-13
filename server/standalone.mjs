#!/usr/bin/env node
// A ready-to-run feedback server, for when you do not have an Express app to mount the router
// in, or want one server collecting feedback for several sites.
//
//   DATABASE_URL=postgres://localhost/feedback npm run server
//
// Environment:
//   DATABASE_URL  Postgres connection string. Without it, comments are kept in memory and lost
//                 when the process stops (it says so on startup).
//   PORT          default 3001
//   CORS_ORIGIN   comma-separated origins allowed to call the API, e.g.
//                 https://app.example.com,http://localhost:5173. Unset means any origin.
//   ADMIN_KEY     enables GET /api/feedback/export, which needs this in X-Api-Key.
//   WRITE_KEY     if set, every API call must carry it in X-Feedback-Key (the widget's
//                 writeKey option / data-write-key / --write-key). Good enough to keep
//                 strangers out of an internal tool; not a substitute for real sign-in, since
//                 the key sits in your page's source. For that, mount feedbackRouter in your
//                 own app and pass authorize().
//   TRUST_PROXY   set when running behind a reverse proxy or load balancer, so the rate limit
//                 counts each reviewer rather than the proxy: "1" (one hop), "true", or an
//                 Express trust-proxy value such as "loopback". Unset trusts nothing.
//
// It also serves the widget itself at /feedback-kit.js and the examples at /examples/, so the
// whole thing can be tried with one command.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { feedbackRouter, postgresStore, memoryStore } from './index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);

export async function createServer(env = process.env) {
  let store;
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    pool.on('error', (err) => console.error('[feedback-kit] idle Postgres client error:', err.message));
    store = postgresStore(pool);
    await store.migrate();
    store.close = () => pool.end();
  } else {
    store = memoryStore();
  }

  const app = express();
  app.disable('x-powered-by');
  const trust = parseTrustProxy(env.TRUST_PROXY);
  if (trust !== undefined) app.set('trust proxy', trust);
  // The widget script is loaded by pages on other origins; the default same-origin resource
  // policy would block exactly the use this server exists for.
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
  }));

  const origins = (env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const corsOpts = {
    origin: origins.length ? origins : '*',
    methods: ['GET', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Feedback-Key', 'Authorization'],
    maxAge: 600
  };

  const api = express.Router();
  api.use(cors(corsOpts));
  api.options('*', cors(corsOpts));
  // Generous: a reviewer resolving twenty comments in a minute is normal use.
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  api.use(feedbackRouter({
    store,
    adminKey: env.ADMIN_KEY || null,
    authorize: env.WRITE_KEY ? (req) => req.get('x-feedback-key') === env.WRITE_KEY : null
  }));
  app.use('/api/feedback', api);

  app.get('/feedback-kit.js', (req, res) => res.sendFile(join(ROOT, 'dist', 'widget.min.js')));
  app.get('/feedback-kit.mjs', (req, res) => res.sendFile(join(ROOT, 'dist', 'feedback-kit.mjs')));
  app.use('/examples', express.static(join(ROOT, 'examples')));
  // The single-page-app example routes on the client, so every path under it is the same page.
  app.get('/examples/spa/*', (req, res) => res.sendFile(join(ROOT, 'examples', 'spa.html')));
  app.get('/', (req, res) => res.redirect('/examples/'));

  return { app, store, origins };
}

// Express's trust-proxy setting from an environment string: a hop count, a boolean, or a
// list of addresses/subnets ("loopback", "10.0.0.0/8, 127.0.0.1").
export function parseTrustProxy(v) {
  if (v == null || v === '') return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { app, store, origins } = await createServer();
  const server = app.listen(PORT, () => {
    console.log(`feedback-kit server on http://localhost:${PORT}`);
    console.log(`  API       http://localhost:${PORT}/api/feedback`);
    console.log(`  widget    http://localhost:${PORT}/feedback-kit.js`);
    console.log(`  examples  http://localhost:${PORT}/examples/`);
    if (store.name === 'memory') {
      console.warn('  WARNING   no DATABASE_URL: comments are kept in memory and lost when this stops.');
    }
    if (!origins.length) console.warn('  note      CORS_ORIGIN not set: any website may call this API.');
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(async (err) => {
      try { if (store.close) await store.close(); } catch (e) { console.error('[feedback-kit] closing the store failed:', e); }
      process.exit(err ? 1 : 0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
