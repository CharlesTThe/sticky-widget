// The HTTP side of server mode. Mount it in your own Express app:
//
//   import express from 'express';
//   import { feedbackRouter, postgresStore } from 'feedback-kit/server';
//   const store = postgresStore(pool);
//   await store.migrate();
//   app.use('/api/feedback', feedbackRouter({ store }));
//
// and point the widget at it: FeedbackKit.init({ endpoint: '/api/feedback' }).
//
// Endpoints (relative to where it is mounted; the contract is references/server.md):
//   GET    /comments?page=P          this page's comments and tombstones
//   PUT    /comments/:id             body { page, comment } — create or update
//   DELETE /comments/:id?page=P&deletedAt=T
//   GET    /export?page=&since=&limit=   every live comment, for triage (needs adminKey)
//   GET    /health
import express from 'express';

const ID = /^c-[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MAX_PAGE = 2048;
const MAX_TEXT = 10000;
const MAX_BODY = '96kb';

// Strict ISO 8601 with a time and a zone, which is what the widget writes (toISOString) and
// what Postgres's timestamptz reads the same way. Date.parse alone accepts "1" and
// "2024-01-01 junk", which then failed in the database as a 500 instead of a 400 here.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

function isoOrNull(v) {
  if (typeof v !== 'string' || !ISO.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : v;
}

function bad(res, status, error) { res.status(status).json({ error }); }

// What a comment must look like before it is stored. Deliberately structural, like the
// file validator: unknown keys are kept, because a newer widget may send fields this server
// does not know, and dropping them would lose data on its way through.
function checkComment(id, c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'comment must be an object';
  if (c.id !== id) return 'comment.id must match the id in the URL';
  if (!isoOrNull(c.createdAt)) return 'comment.createdAt must be an ISO date';
  if (!isoOrNull(c.updatedAt)) return 'comment.updatedAt must be an ISO date';
  if (typeof c.text !== 'string') return 'comment.text must be a string';
  if (c.text.length > MAX_TEXT) return `comment.text must be at most ${MAX_TEXT} characters`;
  if (c.author != null && (typeof c.author !== 'object' || Array.isArray(c.author))) return 'comment.author must be an object or null';
  if (c.anchor != null && (typeof c.anchor !== 'object' || Array.isArray(c.anchor))) return 'comment.anchor must be an object';
  // A clock far in the future would win every merge forever after.
  if (Date.parse(c.updatedAt) > Date.now() + 24 * 3600 * 1000) return 'comment.updatedAt is more than a day in the future';
  return null;
}

function checkPage(page) {
  if (typeof page !== 'string' || !page) return 'page is required';
  if (page.length > MAX_PAGE) return `page must be at most ${MAX_PAGE} characters`;
  return null;
}

/**
 * @param {object} opts
 * @param {object} opts.store       postgresStore(pool) or memoryStore()
 * @param {Function} [opts.authorize]  (req, { action, page }) => boolean | Promise<boolean>.
 *        action is 'read' | 'write' | 'delete'. Return false to answer 403. Use it to tie
 *        feedback to your own sign-in, or to limit which pages accept feedback. If it throws
 *        (your session store is down, say) the answer is 503, which the widget retries; a 403
 *        would tell it the reviewer is not allowed, which nobody decided.
 * @param {string} [opts.adminKey]  required in the X-Api-Key header for GET /export. Without
 *        one, /export is switched off rather than left open.
 */
export function feedbackRouter({ store, authorize = null, adminKey = null } = {}) {
  if (!store) throw new Error('feedbackRouter needs a store: postgresStore(pool) or memoryStore()');
  const router = express.Router();
  router.use(express.json({ limit: MAX_BODY }));

  const allowed = async (req, res, action, page) => {
    if (!authorize) return true;
    let ok;
    try {
      ok = await authorize(req, { action, page });
    } catch (err) {
      console.error('[feedback-kit] authorize() threw:', err);
      bad(res, 503, 'could not check access; try again');
      return false;
    }
    if (ok) return true;
    bad(res, 403, 'not allowed');
    return false;
  };

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[feedback-kit] request failed:', err);
      if (!res.headersSent) bad(res, 500, 'storage error');
    });
  };

  router.get('/health', (req, res) => res.json({ ok: true, store: store.name || 'custom' }));

  router.get('/comments', wrap(async (req, res) => {
    const page = req.query.page;
    const why = checkPage(page);
    if (why) return bad(res, 400, why);
    if (!(await allowed(req, res, 'read', page))) return;
    res.set('Cache-Control', 'no-store');
    res.json(await store.list(page));
  }));

  router.put('/comments/:id', wrap(async (req, res) => {
    const id = req.params.id;
    if (!ID.test(id)) return bad(res, 400, 'invalid comment id');
    const { page, comment } = req.body || {};
    const why = checkPage(page) || checkComment(id, comment);
    if (why) return bad(res, 400, why);
    if (!(await allowed(req, res, 'write', page))) return;
    const out = await store.upsert(page, comment);
    if (out.conflict) return bad(res, 409, 'that comment id belongs to another page');
    res.json({ ok: true, ...out });
  }));

  router.delete('/comments/:id', wrap(async (req, res) => {
    const id = req.params.id;
    if (!ID.test(id)) return bad(res, 400, 'invalid comment id');
    const page = req.query.page;
    const why = checkPage(page);
    if (why) return bad(res, 400, why);
    const deletedAt = isoOrNull(req.query.deletedAt) || new Date().toISOString();
    if (!(await allowed(req, res, 'delete', page))) return;
    const out = await store.remove(page, id, deletedAt);
    if (out.conflict) return bad(res, 409, 'that comment id belongs to another page');
    res.json({ ok: true, ...out });
  }));

  router.get('/export', wrap(async (req, res) => {
    if (!adminKey) return bad(res, 404, 'export is disabled: set adminKey to enable it');
    if (req.get('x-api-key') !== adminKey) return bad(res, 401, 'a valid X-Api-Key header is required');
    const { page = null, since = null, limit = 1000 } = req.query;
    // A repeated parameter arrives as an array, which the store would hand to SQL as one.
    if ([page, since, limit].some((v) => v !== null && typeof v !== 'string' && typeof v !== 'number')) {
      return bad(res, 400, 'page, since and limit may each be given once');
    }
    res.set('Cache-Control', 'no-store');
    res.json({ comments: await store.export({ page, since: isoOrNull(since), limit }) });
  }));

  // Errors from express.json (malformed JSON 400, body too large 413) answer in the same JSON
  // shape as everything else, rather than Express's HTML page with a stack trace.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[feedback-kit] request failed:', err);
    if (res.headersSent) return;
    bad(res, status, status === 413 ? 'request body is too large'
      : status === 400 ? 'request body is not valid JSON' : 'request failed');
  });

  return router;
}
