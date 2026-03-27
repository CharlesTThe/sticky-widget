const { Router } = require('express');

// Field length limits
const MAX_ID_LENGTH = 256;
const MAX_COMMENT_LENGTH = 5000;
const MAX_TEXT_LENGTH = 10000;
const MAX_URL_LENGTH = 2048;
const MAX_SELECTOR_LENGTH = 500;
const MAX_LABEL_LENGTH = 500;

function stickyRouter(pool) {
  const router = Router();

  // POST /feedback
  router.post('/feedback', async (req, res) => {
    const { id, timestamp, pageUrl, target, selectedText, comment, metadata, user, consoleLogs } = req.body;

    if (!id || !comment) {
      return res.status(400).json({ error: 'id and comment are required' });
    }

    // Validate field lengths
    if (typeof id !== 'string' || id.length > MAX_ID_LENGTH) {
      return res.status(400).json({ error: `id must be a string of max ${MAX_ID_LENGTH} characters` });
    }
    if (typeof comment !== 'string' || comment.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `comment must be max ${MAX_COMMENT_LENGTH} characters` });
    }
    if (selectedText && (typeof selectedText !== 'string' || selectedText.length > MAX_TEXT_LENGTH)) {
      return res.status(400).json({ error: `selectedText must be max ${MAX_TEXT_LENGTH} characters` });
    }
    if (pageUrl && (typeof pageUrl !== 'string' || pageUrl.length > MAX_URL_LENGTH)) {
      return res.status(400).json({ error: `pageUrl must be max ${MAX_URL_LENGTH} characters` });
    }

    // Validate timestamp if provided — must be a parseable date
    let ts = null;
    if (timestamp) {
      const parsed = new Date(timestamp);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'timestamp must be a valid ISO 8601 date string' });
      }
      ts = parsed.toISOString();
    } else {
      ts = new Date().toISOString();
    }

    try {
      await pool.query(
        `INSERT INTO feedback
           (id, timestamp, page_url, selector, tag_name, element_id, label, rect, selected_text, comment, metadata, user_name, user_email, console_logs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          ts,
          pageUrl || null,
          (target?.selector || '').slice(0, MAX_SELECTOR_LENGTH) || null,
          target?.tagName || null,
          target?.id || null,
          (target?.label || '').slice(0, MAX_LABEL_LENGTH) || null,
          target?.rect ? JSON.stringify(target.rect) : null,
          selectedText || null,
          comment,
          metadata ? JSON.stringify(metadata) : null,
          user?.name || null,
          user?.email || null,
          consoleLogs ? JSON.stringify(consoleLogs) : null,
        ]
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[sticky-widget] Insert failed:', err.stack);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // GET /feedback — protected by optional API key
  router.get('/feedback', (req, res, next) => {
    const apiSecret = process.env.API_SECRET;
    // Use explicit check — empty string should not silently disable auth
    if (apiSecret != null && apiSecret !== '' && req.headers['x-api-key'] !== apiSecret) {
      return res.status(401).json({ error: 'Unauthorized. Provide a valid X-API-Key header.' });
    }
    next();
  }, async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200'
      );
      res.json(rows);
    } catch (err) {
      console.error('[sticky-widget] Query failed:', err.stack);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
}

module.exports = { stickyRouter };
