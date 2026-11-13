// The module entry: `import FeedbackKit from 'feedback-kit'` or `import { init } from 'feedback-kit'`.
//
// This is a thin re-export of the one runtime in widget.js, which installs window.FeedbackKit
// when it loads. Importing it on a server (server-side rendering) is safe: the runtime does
// nothing without a document. There, init() and status() return null, getComments() an empty
// array, sync() a resolved promise, and the rest do nothing.
import './widget.js';

function kit() {
  return typeof window !== 'undefined' && window.FeedbackKit ? window.FeedbackKit : null;
}

/** Start the widget (or restart it with new options). Returns the instance. */
export function init(options) { const k = kit(); return k ? k.init(options || {}) : null; }
/** Remove the widget from the page. Comments are kept wherever they were stored. */
export function destroy() { const k = kit(); if (k) k.destroy(); }
/** Start picking an element to comment on, as if the + button was pressed. */
export function open() { const k = kit(); return k ? k.open() : undefined; }
/** Stop picking and close any open panel. */
export function close() { const k = kit(); return k ? k.close() : undefined; }
/** Open the list of every comment on this page. */
export function openReview() { const k = kit(); return k ? k.openReview() : undefined; }
/** File mode: save into the file. Server mode: send everything now. Local mode: nothing. */
export function save() { const k = kit(); return k ? k.save() : undefined; }
/** Server mode: fetch other people's comments now and send anything pending. */
export function sync() { const k = kit(); return k ? k.sync() : Promise.resolve(); }
/** Tell the widget who is signed in, e.g. after your auth finishes loading. */
export function setUser(user) { const k = kit(); return k ? k.setUser(user) : undefined; }
/** A copy of this page's comments. */
export function getComments() { const k = kit(); return k ? k.getComments() : []; }
/** { mode, page, comments, pending, rejected, otherPending, dirty, lastError, loaded } or null. */
export function status() { const k = kit(); return k ? k.status() : null; }

const FeedbackKit = { init, destroy, open, close, openReview, save, sync, setUser, getComments, status };
export default FeedbackKit;
