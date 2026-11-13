// In-memory storage: the same contract as postgresStore, for trying things out and for tests.
// Everything is gone when the process exits. The standalone server says so loudly when it
// falls back to this.
export function memoryStore() {
  const rows = new Map(); // id -> { page, data, updatedAt, deletedAt }

  return {
    name: 'memory',
    async migrate() {},

    async list(page) {
      const comments = [];
      const tombstones = [];
      for (const [id, r] of rows) {
        if (r.page !== page) continue;
        if (r.deletedAt) tombstones.push({ id, deletedAt: r.deletedAt });
        else comments.push(r.data);
      }
      comments.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return { comments, tombstones };
    },

    async upsert(page, c) {
      const r = rows.get(c.id);
      if (!r) {
        rows.set(c.id, { page, data: c, updatedAt: c.updatedAt, deletedAt: null });
        return { comment: c };
      }
      if (r.page !== page) return { conflict: 'page' };
      if (r.deletedAt) return { deleted: true, deletedAt: r.deletedAt };
      if (Date.parse(c.updatedAt) > Date.parse(r.updatedAt)) {
        r.data = c;
        r.updatedAt = c.updatedAt;
      }
      return { comment: r.data };
    },

    async remove(page, id, deletedAt) {
      const r = rows.get(id);
      if (r && r.page !== page) return { conflict: 'page' };
      if (!r) rows.set(id, { page, data: {}, updatedAt: deletedAt, deletedAt });
      else if (!r.deletedAt) r.deletedAt = deletedAt;
      return { deleted: true, deletedAt: rows.get(id).deletedAt };
    },

    async export({ page = null, since = null, limit = 1000 } = {}) {
      const out = [];
      for (const r of rows.values()) {
        if (r.deletedAt) continue;
        if (page && r.page !== page) continue;
        if (since && !(Date.parse(r.updatedAt) > Date.parse(since))) continue;
        out.push({ ...r.data, page: r.page });
      }
      out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return out.slice(0, Math.max(1, Math.min(5000, Number(limit) || 1000)));
    }
  };
}
