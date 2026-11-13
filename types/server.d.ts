import type { Router, Request } from 'express';
import type { FeedbackComment, Tombstone } from './index.js';

export type ExportedComment = FeedbackComment & { page: string };

/** What a store must do. server/stores/memory.mjs is the reference implementation. */
export interface FeedbackStore {
  name?: string;
  migrate?(): Promise<void>;
  list(page: string): Promise<{ comments: FeedbackComment[]; tombstones: Tombstone[] }>;
  upsert(page: string, comment: FeedbackComment): Promise<
    { comment: FeedbackComment } | { deleted: true; deletedAt: string } | { conflict: 'page' }>;
  remove(page: string, id: string, deletedAt: string): Promise<
    { deleted: true; deletedAt: string } | { conflict: 'page' }>;
  export(query: { page?: string | null; since?: string | null; limit?: number | string }): Promise<ExportedComment[]>;
  close?(): Promise<void>;
}

export interface FeedbackRouterOptions {
  store: FeedbackStore;
  /**
   * Return false to answer 403. Throwing answers 503, which the widget retries.
   * action is 'read' | 'write' | 'delete'.
   */
  authorize?: ((req: Request, ctx: { action: 'read' | 'write' | 'delete'; page: string }) => boolean | Promise<boolean>) | null;
  /** Required in X-Api-Key for GET /export. Without it, /export answers 404. */
  adminKey?: string | null;
}

export function feedbackRouter(options: FeedbackRouterOptions): Router;

/** Anything with pg.Pool's query(). */
export interface QueryablePool {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export function postgresStore(pool: QueryablePool): FeedbackStore & { migrate(): Promise<void> };
export function memoryStore(): FeedbackStore;
