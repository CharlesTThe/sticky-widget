export type Mode = 'auto' | 'file' | 'server' | 'local';

export interface FeedbackUser {
  name: string;
  email?: string | null;
}

export interface Anchor {
  tag: string;
  id: string | null;
  path: string;
  aria: string | null;
  sig: string;
  quote: { exact: string } | null;
  hint: { hash: string; label: string } | null;
}

export interface FeedbackComment {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  author: FeedbackUser | null;
  text: string;
  originalText: string | null;
  resolved: boolean;
  toolBuild: string | null;
  /** A change the reviewer made to the page's own text. */
  rewrite: { from: string; to: string; at: string } | null;
  /** Empty on a comment that arrived without a usable anchor (an import, an old file). */
  anchor: Anchor | Record<string, never>;
  /** Where it was written. Not present in file mode. */
  context?: {
    page: string;
    url: string;
    title: string;
    viewport: string;
    userAgent: string;
    language: string | null;
  };
  /** Recent console errors and warnings, when captureConsole is on. */
  console?: { level: 'error' | 'warn'; message: string; at: string }[];
  [extra: string]: unknown;
}

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface FeedbackOptions {
  /** Default 'auto': file on an injected HTML file, server when `endpoint` is set, else local. */
  mode?: Mode;
  /** Base URL of a feedback server, e.g. '/api/feedback'. Turns on server mode. */
  endpoint?: string;
  /**
   * What counts as "the same page". Default: origin + pathname (query and hash ignored).
   * A function is re-read on every client-side navigation.
   */
  pageId?: string | (() => string | null | undefined);
  /** Who is commenting. When set, reviewers are never asked for their name. */
  user?: FeedbackUser | null;
  /** Extra request headers for server mode, e.g. an auth token. A function is called per request. */
  headers?: Record<string, string> | (() => Record<string, string> | null | undefined);
  /** The standalone server's WRITE_KEY, sent as X-Feedback-Key. Readable by anyone who reads the page. */
  writeKey?: string;
  /**
   * Whose suggested wording is applied to the page. 'all' in file and local mode; 'mine' in
   * server mode, where anyone who can reach the server could otherwise change what every
   * visitor reads. Others' suggestions are still listed in the review panel.
   */
  showRewrites?: 'all' | 'mine';
  /** fetch credentials mode for server requests. Default 'same-origin'. */
  credentials?: 'omit' | 'same-origin' | 'include';
  /** Button and pin colour. Default: detected from the page's CSS variables. */
  accent?: string;
  position?: 'bottom-right' | 'bottom-left';
  /** Attach recent console errors/warnings to new comments. Off by default; never in file mode. */
  captureConsole?: boolean;
  /** Let reviewers retype text-only elements. Default true. */
  textEdits?: boolean;
  /** Server mode: seconds between background refreshes while the tab is visible. 0 = off. Default 60. */
  pollInterval?: number;
  /** Server mode: let Cmd/Ctrl+S mean "send now". Default true. */
  saveShortcut?: boolean;

  onSubmit?: (comment: FeedbackComment) => void;
  onChange?: (state: { mode: Mode; page: string; comments: FeedbackComment[]; tombstones: Tombstone[] }) => void;
  /** Once per distinct problem. `status` is the HTTP status when the server answered. */
  onError?: (error: FeedbackError) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onPageChange?: (page: string) => void;
}

export interface FeedbackError extends Error {
  status?: number;
}

/** What Download JSON produces and Import JSON reads. */
export interface FeedbackExport {
  comments: FeedbackComment[];
  tombstones?: Tombstone[];
  [extra: string]: unknown;
}

export interface FeedbackStatus {
  mode: Exclude<Mode, 'auto'>;
  page: string;
  comments: number;
  /** Server mode: changes not yet confirmed by the server. */
  pending: number;
  /** Server mode: changes on this page the server refused for good (invalid, wrong page …). */
  rejected: number;
  /** Server mode: changes made on other pages of this app, not yet confirmed. */
  otherPending: number;
  dirty: boolean;
  lastError: string | null;
  loaded: boolean;
}

export interface FeedbackInstance {
  version: string;
  mode: Exclude<Mode, 'auto'>;
  /** The storage id: the file's content hash, or 'p-' + a hash of the page id. */
  readonly docId: string;
  getPage(): string;
  getComments(): FeedbackComment[];
  open(): void;
  close(): void;
  openReview(): void;
  save(): void;
  sync(): Promise<void>;
  setUser(user: FeedbackUser | null): void;
  exportJson(): FeedbackExport;
  importJson(data: FeedbackExport): void;
  status(): FeedbackStatus;
  destroy(): void;
}

export function init(options?: FeedbackOptions): FeedbackInstance | null;
export function destroy(): void;
export function open(): void;
export function close(): void;
export function openReview(): void;
export function save(): void;
export function sync(): Promise<void>;
export function setUser(user: FeedbackUser | null): void;
export function getComments(): FeedbackComment[];
export function status(): FeedbackStatus | null;

export interface FeedbackKitGlobal {
  version: string;
  init: typeof init;
  destroy: typeof destroy;
  open: typeof open;
  close: typeof close;
  openReview: typeof openReview;
  save: typeof save;
  sync: typeof sync;
  setUser: typeof setUser;
  getComments: typeof getComments;
  status: typeof status;
  /** The running widget, if any. */
  instance(): FeedbackInstance | null;
}

declare const FeedbackKit: FeedbackKitGlobal;
export default FeedbackKit;

declare global {
  interface Window {
    /** Set by the script-tag build (feedback-kit.js / dist/widget.min.js). */
    FeedbackKit?: FeedbackKitGlobal;
  }
}
