// Postgres storage for the feedback router.
//
//   import pg from 'pg';
//   const store = postgresStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
//   await store.migrate();             // creates the table if it is not there
//
// Every write follows the widget's own merge rule, enforced in SQL so that two servers, or two
// requests racing, cannot break it: the newer `updatedAt` wins, and a tombstone always wins.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql'), 'utf8');

function iso(v) { return v instanceof Date ? v.toISOString() : v == null ? null : String(v); }

export function postgresStore(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('postgresStore needs a pg Pool (or anything with query())');

  async function current(id) {
    const { rows } = await pool.query(
      'SELECT page, data, deleted_at FROM feedback_comments WHERE id = $1', [id]);
    return rows[0] || null;
  }

  return {
    name: 'postgres',

    async migrate() {
      // Statements one at a time: some drivers and proxies refuse multi-statement queries.
      for (const stmt of SCHEMA.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
        await pool.query(stmt);
      }
    },

    async list(page) {
      const { rows } = await pool.query(
        `SELECT id, data, deleted_at FROM feedback_comments
          WHERE page = $1 ORDER BY created_at ASC LIMIT 5000`, [page]);
      const comments = [];
      const tombstones = [];
      for (const r of rows) {
        if (r.deleted_at) tombstones.push({ id: r.id, deletedAt: iso(r.deleted_at) });
        else comments.push(r.data);
      }
      return { comments, tombstones };
    },

    // Returns { comment } with whichever version won, or { deleted, deletedAt } if the comment
    // is tombstoned, or { conflict: 'page' } if the id already belongs to another page.
    async upsert(page, c) {
      await pool.query(
        `INSERT INTO feedback_comments
           (id, page, data, author_name, author_email, text, resolved, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           author_name = EXCLUDED.author_name,
           author_email = EXCLUDED.author_email,
           text = EXCLUDED.text,
           resolved = EXCLUDED.resolved,
           updated_at = EXCLUDED.updated_at
         WHERE feedback_comments.deleted_at IS NULL
           AND feedback_comments.page = EXCLUDED.page
           AND feedback_comments.updated_at < EXCLUDED.updated_at`,
        [
          c.id, page, JSON.stringify(c),
          c.author && c.author.name ? String(c.author.name) : null,
          c.author && c.author.email ? String(c.author.email) : null,
          String(c.text || ''), c.resolved === true,
          c.createdAt, c.updatedAt
        ]);
      const row = await current(c.id);
      if (!row) return { comment: c };
      if (row.page !== page) return { conflict: 'page' };
      if (row.deleted_at) return { deleted: true, deletedAt: iso(row.deleted_at) };
      return { comment: row.data };
    },

    async remove(page, id, deletedAt) {
      // The tombstone is stored even for a comment this server never saw: the browser that
      // deleted it may be the only one that knew it, and another browser may still upload it.
      await pool.query(
        `INSERT INTO feedback_comments (id, page, data, created_at, updated_at, deleted_at)
         VALUES ($1, $2, '{}'::jsonb, $3, $3, $3)
         ON CONFLICT (id) DO UPDATE SET deleted_at = COALESCE(feedback_comments.deleted_at, EXCLUDED.deleted_at)
         WHERE feedback_comments.page = EXCLUDED.page`,
        [id, page, deletedAt]);
      const row = await current(id);
      if (row && row.page !== page) return { conflict: 'page' };
      return { deleted: true, deletedAt: iso(row && row.deleted_at) || deletedAt };
    },

    // For people triaging, not for the widget: every live comment, newest change first.
    async export({ page = null, since = null, limit = 1000 } = {}) {
      const where = ['deleted_at IS NULL'];
      const args = [];
      if (page) { args.push(page); where.push(`page = $${args.length}`); }
      if (since) { args.push(since); where.push(`updated_at > $${args.length}`); }
      args.push(Math.max(1, Math.min(5000, Number(limit) || 1000)));
      const { rows } = await pool.query(
        `SELECT page, data FROM feedback_comments WHERE ${where.join(' AND ')}
          ORDER BY updated_at DESC LIMIT $${args.length}`, args);
      return rows.map((r) => ({ ...r.data, page: r.page }));
    }
  };
}
