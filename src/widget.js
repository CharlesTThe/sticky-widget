/*
  feedback-kit — feedback widget runtime
  ---------------------------------------------------------------------------
  WHAT THIS IS
  A review tool for anything with a DOM. A reviewer clicks any part of the
  page, types a note, and a small numbered pin sits on that spot from then on.
  Where the notes go is the one thing that changes between pages, chosen by
  `mode`:

    file    written back INTO the HTML file on Cmd/Ctrl+S, so the next person
            to open it just sees them. No backend. Picked automatically on a
            page made by bin/add-feedback.mjs.
    server  synced two ways with a feedback server (server/), with an offline
            outbox in localStorage. Picked when `endpoint` is given.
    local   kept in this browser; Download JSON hands them on.

  The picker, anchors, pins, threads, text rewrites, review list and JSON
  round-trip are the same code in all three.

  In server mode the server is the database and localStorage is the outbox:
  what the server has confirmed is tracked per comment by `updatedAt`, so
  anything unconfirmed is resent and a reviewer who goes offline loses nothing.

  THE ONE IDEA THAT SHAPES FILE MODE
  The file is the database. Comments live in a JSON island inside the file
  itself. localStorage is only a crash-recovery buffer. That is why the widget
  never mutates the host page's DOM (anchors are purely descriptive) and never
  re-serialises it (saving splices the file's own bytes). Both rules exist
  because the thing we save must be the author's original document, not a
  snapshot of whatever an interactive demo happened to be showing.

  HOW TO TRACE A PROBLEM
  Everything is inside one self-running function so it cannot collide with the
  host page. Jump by the numbered banners:

    1  constants and small helpers
    2  state: island, buffer, merge, dirty tracking
    3  anchors: describing an element, and finding it again
    4  shell: shadow host, theme, CSS
    5  chrome: toast, confirm, focus trap
    6  picker: choosing an element to comment on
    7  pins: drawing and positioning them
    8  panels: comment form, review list, identity
    9  save: the four-rung ladder
   9b  server sync, single-page-app navigation
   10  boot, the public API, window.FeedbackKit and auto-start

  The on-disk contract this implements is references/architecture.md. If you
  change the island format, the escape rule, or the anchor shape, change that
  document and bin/verify.mjs in the same commit. The server's HTTP contract
  is references/server.md.
*/
(function () {
  'use strict';

  // Server-side rendering (Next.js, Nuxt, Remix) imports this module where there is no page.
  // Nothing to attach to there, and touching window would throw during the server render.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Two copies of the runtime on one page would mean two rails and two sets of listeners.
  // Earlier generations had no guard and ten files in the wild ended up double-injected;
  // this is the last line of defence behind the injector's. The first copy wins.
  if (window.FeedbackKit && window.FeedbackKit.__core) return;

  var current = null;
  // Kept in step with package.json by build/build.mjs, which refuses to build if they differ.
  var VERSION = '2.0.0';

  // One widget per page. init() on a page that already has one tears the old one down first,
  // which is also what makes React StrictMode's mount-unmount-mount harmless.
  function createWidget(options) {
    options = options || {};
    // ===========================================================================
    // 1. Constants and small helpers
    // ===========================================================================

    // Both of these are split for the same reason. This source ends up pasted
    // inside the very file it describes, so any token it spells out in full
    // appears twice in that file — once as the real thing, once as this string.
    // A scanner counting occurrences then finds two islands, and the injector
    // refuses the file. Keep them split.
    var CLOSE_SCRIPT = '</' + 'script>';
    // Assembled at runtime, via join, because the minifier constant-folds both
    // plain concatenation AND String.fromCharCode back into one literal. Array
    // join is the cheapest construction it will not evaluate. (It leaves the
    // closing-script sequence above alone, but only as a special case for HTML
    // safety — that protection does not extend to this token.)
    var ISLAND_OPEN = ['<', 'script type="application/json" id="fbw-state">'].join('');
    var SENTINEL_ATTR = 'data-fbw';
    var NS = 'fbw';
    // The state version this runtime IMPLEMENTS, written on every save rather than echoed back
    // from the island. Echoing would let a v1 island round-trip through this build and come out
    // still claiming v1 while carrying rewrites in it — a file that lies about what a reader
    // needs to understand it.
    var STATE_V = 2;
    var MAX_TEXT = 10000;
    var TAIL_SCAN = 2 * 1024 * 1024;

    var doc = document;
    var root = doc.documentElement;

    var log = function (msg, err) {
      try { console.warn('[fbw] ' + msg, err || ''); } catch (e) {}
    };

    // Every entry point runs inside this. A bug in the review tool must never
    // take down the document it is reviewing.
    function guard(fn, label) {
      return function () {
        try { return fn.apply(this, arguments); }
        catch (err) { log('failed in ' + label, err); }
      };
    }

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn, opts]);
    }
    var listeners = [];

    function nowISO() { return new Date().toISOString(); }

    function newId() {
      var b = new Uint8Array(6);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
      else for (var i = 0; i < 6; i++) b[i] = Math.floor(Math.random() * 256);
      var s = '';
      for (var j = 0; j < 6; j++) s += (b[j] + 0x100).toString(16).slice(1);
      return 'c-' + s;
    }

    // Not cryptographic and does not need to be. It answers one question —
    // "has the comment list changed since the last successful save?" — and it
    // has to answer it synchronously, which rules out crypto.subtle.
    function quickHash(str) {
      var h1 = 0x811c9dc5, h2 = 0x01000193;
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
        h2 = (h2 + c) >>> 0; h2 = Math.imul(h2, 2246822519) >>> 0;
      }
      return h1.toString(16) + h2.toString(16);
    }

    function clampText(s) {
      s = String(s == null ? '' : s);
      return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
    }

    // Markup whitespace as the page renders it, for anywhere a stored string is shown back to
    // a human: a rewrite keeps the source file's own indentation in `from`, which would
    // otherwise arrive in the review list as a line break and four spaces.
    function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
    function clip(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

    function fmtWhen(iso) {
      try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
      } catch (e) { return ''; }
    }

    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // ===========================================================================
    // 2. State
    // ===========================================================================

    var islandEl = doc.getElementById('fbw-state');
    var fileState = readIsland();
    var islandCfg = fileState.config || {};

    // --- mode -----------------------------------------------------------------
    // An injected file carries its island, and that decides it: a file is file mode unless the
    // injector was given an endpoint, in which case every copy of the deck syncs to one server.
    // Elsewhere an endpoint means server mode and nothing means this browser only.
    var endpoint = options.endpoint || islandCfg.endpoint || null;
    var writeKey = options.writeKey || islandCfg.writeKey || null;
    writeKey = writeKey ? String(writeKey) : null;
    var MODE = options.mode && options.mode !== 'auto' ? String(options.mode)
      : (islandEl ? (endpoint ? 'server' : 'file') : (endpoint ? 'server' : 'local'));
    if (MODE === 'file' && !islandEl) {
      log('mode "file" needs a page prepared with bin/add-feedback.mjs; keeping comments in this browser instead');
      MODE = 'local';
    }
    if (MODE === 'server' && !endpoint) {
      log('mode "server" needs an endpoint; keeping comments in this browser instead');
      MODE = 'local';
    }
    if (MODE !== 'file' && MODE !== 'server') MODE = 'local';
    var FILE = MODE === 'file';
    var SERVER = MODE === 'server';
    // Outside file mode an island is only a seed: its comments are merged in once and, on a
    // server, uploaded like any other unsent comment.
    var seed = FILE ? null : fileState;
    if (!FILE) fileState = { v: STATE_V, docId: '', title: '', config: {}, comments: [], tombstones: [] };

    // What a page IS, for everything that is not a file. The file hashes its own text; an app
    // has no text of its own to hash, so it is identified by where it lives. Query and hash are
    // left out by default because they are usually state, not identity — pass `pageId` when
    // they are identity (a function is re-read on every navigation).
    function currentPageId() {
      var p = options.pageId;
      try { if (typeof p === 'function') p = p(); } catch (e) { p = null; }
      if (p) return String(p).slice(0, 2048);
      if (seed && seed.docId) return 'doc:' + seed.docId;
      if (location.protocol === 'file:' || location.origin === 'null') {
        return location.href.split('#')[0].split('?')[0];
      }
      return location.origin + location.pathname;
    }
    var pageId = FILE ? null : currentPageId();

    function readIsland() {
      var fallback = { v: STATE_V, docId: '', title: '', config: {}, comments: [], tombstones: [] };
      if (!islandEl) return fallback;
      try {
        var parsed = JSON.parse(islandEl.textContent || '{}');
        if (!parsed || typeof parsed !== 'object') return fallback;
        parsed.comments = Array.isArray(parsed.comments) ? parsed.comments : [];
        parsed.tombstones = Array.isArray(parsed.tombstones) ? parsed.tombstones : [];
        parsed.config = parsed.config || {};
        return parsed;
      } catch (err) {
        log('state island is not valid JSON; starting empty', err);
        return fallback;
      }
    }

    // Outside file mode the id is derived from the page id, so the storage keys below are
    // per page. `p-` keeps them apart from file docIds, which are bare hex.
    var docId = FILE ? (fileState.docId || root.getAttribute(SENTINEL_ATTR) || '') : 'p-' + quickHash(pageId);

    // Which widget build is running. The injector stamped it into the island; nothing in here
    // can derive it, because a script cannot reliably hash its own bytes. Every comment this
    // session creates carries it, so a file that has been round-tripped through several
    // generations of the tool still says which one wrote each entry. A page that loaded the
    // runtime from a script tag or a bundle has no island and so no build hash; it still says
    // which version it is.
    var stampSrc = FILE ? fileState.tool : (seed && seed.tool);
    var toolInfo = stampSrc && typeof stampSrc === 'object' ? stampSrc
      : { name: 'feedback-kit', version: VERSION, build: null };
    var toolBuild = toolInfo && typeof toolInfo.build === 'string' ? toolInfo.build : null;

    // Options win over the island: an island's config is what the injector decided for every
    // reader of a file, options are what the page that is running decided just now.
    var pos = options.position || islandCfg.position;
    var cfg = {
      accent: options.accent || islandCfg.accent || null,
      position: pos === 'bottom-left' ? 'bottom-left' : 'bottom-right',
      // Opt-in, and never in file mode: console lines travel inside the file to whoever it is
      // forwarded to, which is the privacy problem references/config.md records.
      captureConsole: !FILE && options.captureConsole === true,
      textEdits: options.textEdits !== false,
      // Whose suggested wording is put onto the page. A file is passed hand to hand among
      // people the author chose, so everyone's is. A server takes comments from anyone who can
      // reach it, and applying theirs would let one of them change what every other visitor
      // reads (a label, a price, an account number), so there only the reviewer's own are
      // applied and everyone else's are listed as suggestions. 'all' restores the file
      // behaviour for a server you trust.
      showRewrites: options.showRewrites === 'all' || options.showRewrites === 'mine'
        ? options.showRewrites : (MODE === 'server' ? 'mine' : 'all')
    };

    var KEY = NS + ':' + docId;
    var KEY_UI = KEY + ':ui';
    var KEY_SYNC = KEY + ':sync';
    var KEY_AUTHOR = NS + ':author';

    // localStorage is unavailable in some private-browsing modes and can be full.
    // Both are survivable — the file still works — but they must never look like
    // success, so storageBroken drives a visible warning rather than a console line.
    var storageBroken = false;

    function lsGet(key) {
      try { return localStorage.getItem(key); }
      catch (e) { storageBroken = true; return null; }
    }
    function lsSet(key, val) {
      try { localStorage.setItem(key, val); return true; }
      catch (e) { storageBroken = true; return false; }
    }

    function readBuffer() {
      var raw = lsGet(KEY);
      if (!raw) return { comments: [], tombstones: [] };
      try {
        var b = JSON.parse(raw);
        return {
          comments: Array.isArray(b.comments) ? b.comments : [],
          tombstones: Array.isArray(b.tombstones) ? b.tombstones : []
        };
      } catch (e) { return { comments: [], tombstones: [] }; }
    }

    var comments = [];
    var tombstones = [];
    var savedHash = null;
    var bufferAhead = 0;

    function normalise(c) {
      if (!c || typeof c !== 'object' || !c.id) return null;
      var out = {};
      for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k];
      out.id = String(c.id);
      out.schemaVersion = 1;
      out.createdAt = c.createdAt || nowISO();
      out.updatedAt = c.updatedAt || out.createdAt;
      // Not clamped here. `normalise` runs on every merge, including on comments that arrived
      // in someone else's file, so clamping at this point silently truncated another
      // reviewer's 12,000-character comment to 10,000 and then wrote the short version back.
      // The cap belongs where text is composed, which is the only place it is ours to cap.
      out.text = String(c.text == null ? '' : c.text);
      out.resolved = c.resolved === true;
      out.originalText = c.originalText == null ? null : String(c.originalText);
      out.author = c.author && typeof c.author === 'object'
        ? { name: String(c.author.name || '').slice(0, 120),
            email: c.author.email ? String(c.author.email).slice(0, 200) : null }
        : null;
      out.toolBuild = typeof c.toolBuild === 'string' ? c.toolBuild : null;
      // A rewrite with from === to is not a record of anything, and it would badge an element
      // whose text is exactly as the author wrote it. Dropped rather than carried.
      out.rewrite = null;
      if (c.rewrite && typeof c.rewrite === 'object') {
        var from = String(c.rewrite.from == null ? '' : c.rewrite.from);
        var to = String(c.rewrite.to == null ? '' : c.rewrite.to);
        if (from !== to) out.rewrite = { from: from, to: to, at: c.rewrite.at || out.updatedAt };
      }
      out.anchor = c.anchor && typeof c.anchor === 'object' ? c.anchor : {};
      return out;
    }

    function timeOf(c) {
      var t = Date.parse(c.updatedAt || c.createdAt || '');
      return isNaN(t) ? 0 : t;
    }

    // Union by id, newer updatedAt wins, tombstones always win. Used for the
    // boot merge and again for every cross-tab storage event, so the two can
    // never drift apart.
    function merge(a, b, tombA, tombB) {
      var dead = {};
      var tombs = [];
      var seenTomb = {};
      [tombA || [], tombB || []].forEach(function (list) {
        list.forEach(function (t) {
          if (!t || !t.id || seenTomb[t.id]) return;
          seenTomb[t.id] = 1;
          dead[t.id] = 1;
          tombs.push({ id: t.id, deletedAt: t.deletedAt || nowISO() });
        });
      });
      var byId = {};
      [a || [], b || []].forEach(function (list) {
        list.forEach(function (raw) {
          var c = normalise(raw);
          if (!c || dead[c.id]) return;
          var cur = byId[c.id];
          if (!cur || timeOf(c) > timeOf(cur)) byId[c.id] = c;
        });
      });
      var merged = Object.keys(byId).map(function (k) { return byId[k]; });
      merged.sort(function (x, y) { return timeOf(x) - timeOf(y); });
      return { comments: merged, tombstones: tombs };
    }

    // The dirty baseline. `rewrite.to` is in here because changing the page's text, or
    // reverting it, is an unsaved change exactly as much as typing a note is — leave it out
    // and the save dot never appears for a reviewer who only retyped a headline.
    function serialiseComments(list) {
      return JSON.stringify(list.map(function (c) {
        return [c.id, c.updatedAt, c.text, c.resolved, c.rewrite ? c.rewrite.to : null];
      }));
    }

    function loadState() {
      var buf = readBuffer();
      if (!FILE) {
        // No file, so nothing is "saved" in the file sense and nothing is ahead of it. The
        // buffer IS the local copy; in server mode the server's copy is merged in by pull().
        var s = seed && seed.docId && ('doc:' + seed.docId) === pageId ? seed : null;
        var mm = merge(buf.comments, s ? s.comments : [], buf.tombstones, s ? s.tombstones : []);
        comments = mm.comments;
        tombstones = mm.tombstones;
        savedHash = quickHash(serialiseComments(comments));
        bufferAhead = 0;
        return;
      }
      var m = merge(fileState.comments, buf.comments, fileState.tombstones, buf.tombstones);
      comments = m.comments;
      tombstones = m.tombstones;

      // The saved baseline is derived from the ISLAND, never from localStorage.
      // What is in the file is by definition saved, so a file opened on a
      // machine that has never seen it reads as clean. Keeping this baseline in
      // the buffer instead made every freshly received file announce itself as
      // having unsaved changes, and armed the beforeunload guard on a page the
      // reader had not even touched.
      // Canonicalised through the same merge path so the two hashes are
      // comparable — ordering and normalisation have to match exactly.
      savedHash = quickHash(serialiseComments(merge(fileState.comments, [], fileState.tombstones, []).comments));

      // The buffer holding comments the file does not is the stale-cache case:
      // an old copy of the document served from cache, opened by someone whose
      // browser still has newer work. Say so rather than quietly reconciling.
      var inFile = {};
      fileState.comments.forEach(function (c) { if (c && c.id) inFile[c.id] = 1; });
      bufferAhead = comments.filter(function (c) { return !inFile[c.id]; }).length;
    }

    // `page` is stored alongside so that an outbox left behind on another page of an app can
    // be flushed from whichever page the reviewer opens next (flushOtherPages).
    function writeBuffer() {
      var ok = lsSet(KEY, JSON.stringify({
        page: pageId, endpoint: SERVER ? endpoint : null, comments: comments, tombstones: tombstones
      }));
      if (!ok) storageBroken = true;
    }

    function persist() {
      writeBuffer();
      syncIsland();
      render();
      if (SERVER) scheduleFlush(0);
      notifyChange();
    }

    // The escape hatch for any storage this runtime does not know: a page can mirror every
    // change into its own backend, analytics or state store. Called after every change, with
    // copies, so a handler that mutates what it is given cannot corrupt the widget.
    function notifyChange() {
      if (typeof options.onChange !== 'function') return;
      try {
        options.onChange({
          mode: MODE, page: FILE ? docId : pageId,
          comments: JSON.parse(JSON.stringify(comments)),
          tombstones: tombstones.slice()
        });
      } catch (err) { log('onChange handler failed', err); }
    }

    function callback(name, arg) {
      if (typeof options[name] !== 'function') return;
      try { options[name](arg); } catch (err) { log(name + ' handler failed', err); }
    }

    function notifySubmit(c) {
      if (typeof options.onSubmit !== 'function') return;
      try { options.onSubmit(JSON.parse(JSON.stringify(c))); }
      catch (err) { log('onSubmit handler failed', err); }
    }

    // Where and on what a comment was written, for the person triaging it later. An app has
    // many pages and many screen sizes, and "the button overlaps the menu" means nothing
    // without the viewport it was seen at. Not added in file mode: there the island's comment
    // shape is a contract (architecture.md §3) and the file already says which document it is.
    function withContext(c) {
      if (FILE || !c) return c;
      c.context = {
        page: pageId,
        url: clip(location.href, 2048),
        title: clip(doc.title || '', 300),
        viewport: innerWidth + 'x' + innerHeight,
        userAgent: clip(navigator.userAgent || '', 300),
        language: navigator.language || null
      };
      if (cfg.captureConsole && consoleBuf.length) c.console = consoleBuf.slice(-20);
      return c;
    }

    // --- console capture (opt-in, never in file mode) --------------------------
    // The last few errors and warnings, attached to each new comment, so "this chart is
    // empty" arrives with the error that emptied it. Capped, held in memory only, and never
    // written to localStorage on its own: the previous generation buffered it there, a page
    // that logged in a loop filled the quota, and every comment write after that failed.
    var consoleBuf = [];
    function pushConsole(level, args) {
      var parts = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        var s;
        if (a instanceof Error) s = a.message;
        else if (typeof a === 'string') s = a;
        else { try { s = JSON.stringify(a); } catch (e) { s = String(a); } }
        parts.push(String(s));
      }
      var msg = clip(parts.join(' '), 500);
      if (msg.indexOf('[fbw]') === 0) return;   // our own diagnostics are not the page's
      consoleBuf.push({ level: level, message: msg, at: nowISO() });
      if (consoleBuf.length > 50) consoleBuf.shift();
    }
    function installConsoleCapture() {
      if (!cfg.captureConsole) return;
      ['error', 'warn'].forEach(function (level) {
        var orig = console[level];
        if (typeof orig !== 'function') return;
        var wrapped = function () {
          try { pushConsole(level, arguments); } catch (e) {}
          return orig.apply(console, arguments);
        };
        console[level] = wrapped;
        teardown.push(function () { if (console[level] === wrapped) console[level] = orig; });
      });
      on(window, 'error', function (e) {
        pushConsole('error', [String(e.message || 'Error') + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '')]);
      });
      on(window, 'unhandledrejection', function (e) {
        var r = e.reason;
        pushConsole('error', ['Unhandled rejection: ' + (r && r.message ? r.message : String(r))]);
      });
    }

    // Keeping the island in the live DOM current is belt and braces: the save
    // ladder does not read it, but a browser "Save Page As" that serialises the
    // DOM will then still capture the current comments.
    function syncIsland() {
      if (!islandEl || !FILE) return;
      try {
        var next = {};
        for (var k in fileState) if (Object.prototype.hasOwnProperty.call(fileState, k)) next[k] = fileState[k];
        next.comments = comments;
        next.tombstones = tombstones;
        islandEl.textContent = encodeIsland(next);
      } catch (err) { log('could not sync the state island', err); }
    }

    // Escaping < and > is sufficient and complete: it makes a closing script tag,
    // an HTML comment opener and a CDATA terminator unrepresentable in the island
    // by construction. A reviewer pasting a literal closing script tag into a
    // comment is exactly the case this defends.
    function encodeIsland(obj) {
      return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    }

    // "Is there something here that has not reached where it is going?" File: not yet written
    // into the file. Server: not yet confirmed by the server. Local: there is nowhere further
    // for it to go, so never.
    function isDirty() {
      if (SERVER) return pendingCount() > 0;
      if (!FILE) return false;
      return quickHash(serialiseComments(comments)) !== savedHash;
    }

    function markSaved() {
      savedHash = quickHash(serialiseComments(comments));
      bufferAhead = 0;
      persist();
    }

    // An app that knows who is signed in passes `user` and the reviewer is never asked. It
    // wins over a name typed earlier in this browser: the sign-in is the stronger claim.
    var appUser = null;
    function setAppUser(u) {
      appUser = u && typeof u === 'object' && u.name
        ? { name: String(u.name).slice(0, 120), email: u.email ? String(u.email).slice(0, 200) : null }
        : null;
    }
    setAppUser(options.user);

    function getAuthor() {
      if (appUser) return appUser;
      var raw = lsGet(KEY_AUTHOR);
      if (!raw) return null;
      try {
        var a = JSON.parse(raw);
        return a && a.name ? { name: String(a.name), email: a.email || null } : null;
      } catch (e) { return null; }
    }
    function setAuthor(a) { lsSet(KEY_AUTHOR, JSON.stringify(a)); }

    // Same person by email when both have one, else by name. Not a security check — a name
    // can be typed by anyone — only "is this my own suggestion", for showRewrites: 'mine'.
    function isMine(c) {
      var me = getAuthor();
      var a = c && c.author;
      if (!me || !a) return false;
      if (me.email && a.email) return String(me.email).toLowerCase() === String(a.email).toLowerCase();
      return !!a.name && a.name === me.name;
    }

    function rewriteShown(c) {
      return !!(c && c.rewrite) && (cfg.showRewrites === 'all' || isMine(c));
    }

    function readUi() {
      try { return JSON.parse(lsGet(KEY_UI) || '{}') || {}; } catch (e) { return {}; }
    }
    var ui = readUi();

    // What a reviewer is told about where their words go. Every message that used to say
    // "save it into the file" comes through here, because in two of the three modes that
    // sentence is false — and a tool that tells someone their work is somewhere it is not is
    // how work gets lost.
    var WORDS = FILE ? {
      where: 'saved into this file',
      then: ' Press Cmd/Ctrl+S to save it into the file.',
      thenMany: ' Press Cmd/Ctrl+S to save them into the file.',
      composerNote: 'Cmd/Ctrl + Enter to add. Your comments are only in this browser until you save the file.',
      saveLabel: 'Save into file',
      storageLost: 'Your comments are held in this tab only — save the file now, or they will be lost when you close it.'
    } : SERVER ? {
      where: 'sent to the team',
      then: '',
      thenMany: '',
      composerNote: 'Cmd/Ctrl + Enter to add. Comments are sent as soon as you add them.',
      saveLabel: 'Send now',
      storageLost: 'Your comments are held in this tab only until the server confirms them — keep this tab open until the review list says everything is sent.'
    } : {
      where: 'kept in this browser',
      then: '',
      thenMany: '',
      composerNote: 'Cmd/Ctrl + Enter to add. Comments stay in this browser; Download JSON in the review list shares them.',
      saveLabel: null,
      storageLost: 'Your comments are held in this tab only — use Download JSON now, or they will be lost when you close it.'
    };
    function saveUi() { lsSet(KEY_UI, JSON.stringify(ui)); }

    // ===========================================================================
    // 3. Anchors
    // ===========================================================================
    //
    // An anchor describes an element well enough to find it again later, WITHOUT
    // writing anything onto the page. The previous generation stamped a unique
    // attribute on the clicked element, which worked until reload — because the
    // file we save is the original source, and the stamp was never in it.
    //
    // So: five independent descriptions, tried in order until one matches exactly
    // one element. Between them they survive re-renders, reordering, and the
    // structurally identical twin cards that a single CSS path cannot tell apart.

    function isOurs(node) {
      return !!(node && hostDiv && (node === hostDiv || (node.closest && node.closest('#fbw-host'))));
    }

    function classSig(node) {
      var cl = (node.getAttribute && node.getAttribute('class')) || '';
      var parts = cl.trim().split(/\s+/).filter(Boolean).sort().slice(0, 4);
      return node.tagName.toLowerCase() + (parts.length ? '.' + parts.join('.') : '');
    }

    function rootedPath(node) {
      var parts = [];
      var n = node;
      while (n && n !== doc.body && n.parentElement) {
        var tag = n.tagName.toLowerCase();
        var sibs = [];
        var kids = n.parentElement.children;
        for (var i = 0; i < kids.length; i++) if (kids[i].tagName === n.tagName) sibs.push(kids[i]);
        // nth-of-type, and always emitted — an index that is only present when
        // it happens to be needed is an index that stops being reproducible the
        // moment a sibling is added.
        parts.unshift(tag + ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')');
        n = n.parentElement;
      }
      return 'body>' + parts.join('>');
    }

    function visibleText(node) {
      var t = '';
      try { t = node.innerText || node.textContent || ''; } catch (e) {}
      return t.replace(/\s+/g, ' ').trim();
    }

    // Only `exact`. The anchor once also carried `prefix` and `suffix` for a fifth fuzzy
    // resolution rung that was documented but never built — nothing read them, and when the
    // recorded text is gone the honest answer is Orphaned, not a guess from its neighbours.
    // `exact` now earns its keep twice over: the quote rung matches on it, and the path rung
    // corroborates against it.
    // Does this element say `want`? Both bases are accepted, and the second is not redundant:
    // a quote is captured through visibleText (the RENDERED text) while a rewrite is written to
    // textContent, and on an element carrying text-transform:uppercase those two never agree.
    // One rule in one place, so the ladder and the rewrite replay cannot drift apart.
    //
    // `want` is collapsed here rather than at the point it is stored, and that is the whole of
    // it: a rewrite keeps the source file's own indentation in `from` so that Revert can put
    // the markup back exactly, and `to` comes out of a textarea so it can carry newlines of its
    // own. Comparing either against a collapsed node is comparing two different quantities. It
    // was false for every element whose text sits on its own indented line — which is the
    // normal shape of authored HTML — so the path rung rejected the very element the comment
    // was written on, the quote rung matched nothing, and the rewrite was dropped and its
    // comment orphaned on an element that had never moved. Where a class signature happened to
    // be unique the sig rung rescued it, which is worse: the feature appeared to work while
    // resolving on the weakest locator every time.
    function saysText(node, want) {
      var w = collapse(want);
      return visibleText(node) === w || collapse(node.textContent) === w;
    }

    function quoteFor(node) {
      var exact = visibleText(node).slice(0, 180);
      return exact ? { exact: exact } : null;
    }

    function labelFor(node) {
      return node.getAttribute('aria-label')
        || node.getAttribute('data-label')
        || node.getAttribute('title')
        || null;
    }

    function sectionHint(node) {
      var sec = node.closest ? node.closest('section,article,[id]') : null;
      var label = sec ? (labelFor(sec) || (sec.id ? '#' + sec.id : '')) : '';
      if (!label && sec) {
        var h = sec.querySelector && sec.querySelector('h1,h2,h3');
        if (h) label = visibleText(h).slice(0, 60);
      }
      return { hash: location.hash || '', label: label || '' };
    }

    function describe(node) {
      var idAttr = node.id || '';
      var uniqueId = '';
      if (idAttr) {
        try { if (doc.querySelectorAll('[id="' + cssQuote(idAttr) + '"]').length === 1) uniqueId = idAttr; }
        catch (e) {}
      }
      var sig = classSig(node);
      var all = [];
      try { all = Array.prototype.slice.call(doc.querySelectorAll(node.tagName.toLowerCase())); } catch (e) {}
      var peers = all.filter(function (n) { return classSig(n) === sig; });
      return {
        tag: node.tagName.toLowerCase(),
        id: uniqueId || null,
        path: rootedPath(node),
        aria: labelFor(node),
        // The `|N` ordinal is RESERVED, not dead. Nothing reads it any more — resolveAnchor
        // takes `sig.split('|')[0]` — because indexing into a pool that has changed is how a
        // comment ends up confidently on the wrong element. It is still written because it is
        // part of the persisted anchor shape in architecture.md §3 and files in the wild carry
        // it. Removing it is a format change and needs to be made as one, not tidied away
        // alongside an unused local.
        sig: sig + '|' + peers.indexOf(node),
        quote: quoteFor(node),
        hint: sectionHint(node)
      };
    }

    function cssQuote(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    function one(nodes) {
      var live = [];
      for (var i = 0; i < nodes.length; i++) if (!isOurs(nodes[i])) live.push(nodes[i]);
      return live.length === 1 ? live[0] : null;
    }

    function qsa(sel) {
      try { return doc.querySelectorAll(sel); } catch (e) { return []; }
    }

    // Returns { node, via } or null. `via` drives the "moved" badge, so the
    // reviewer can see when a comment had to be re-found by a weaker signal.
    // `expected` is what the element should say RIGHT NOW, overriding the anchor's recorded
    // quote. It exists for rewrites: once a rewrite is applied the element no longer says what
    // its anchor recorded, so corroborating against the quote rejects the very element the
    // comment was written on. The comment then degrades to a weaker rung, or orphans outright
    // on a deck where many elements share a class signature — which is most real decks. The
    // quote is still the right record of what was there at capture time; it is just not the
    // right thing to look for afterwards.
    function resolveAnchor(a, expected) {
      if (!a) return null;
      var want = expected == null ? ((a.quote && a.quote.exact) || null) : expected;
      var n;

      if (a.id) {
        n = one(qsa('[id="' + cssQuote(a.id) + '"]'));
        if (n) return { node: n, via: 'id' };
      }
      if (a.path) {
        n = one(qsa(a.path));
        // A rooted path is POSITIONAL: `div:nth-of-type(3)` names a slot, not an element.
        // Delete the element the comment was written on and the next sibling slides into that
        // slot, where the very same selector matches it. `path` is one of the two rungs that
        // does not raise the "moved" badge, so unchecked it hands the reviewer a confident,
        // unmarked pin on content the comment was never about — a comment about "3.2x" sitting
        // on the card that says "4.1x". If we recorded what the element said and it no longer
        // says it, treat it as a different element: fall through and let a weaker, badged rung
        // have it, or let it orphan honestly.
        if (n && (!want || saysText(n, want))) {
          return { node: n, via: 'path' };
        }
      }
      if (a.aria) {
        n = one(qsa('[aria-label="' + cssQuote(a.aria) + '"]'));
        if (n) return { node: n, via: 'aria' };
      }
      if (want) {
        var hits = [];
        var cands = qsa(a.tag || '*');
        for (var i = 0; i < cands.length && hits.length < 4; i++) {
          if (isOurs(cands[i])) continue;
          if (saysText(cands[i], want)) hits.push(cands[i]);
        }
        if (hits.length === 1) return { node: hits[0], via: 'text' };
        if (hits.length > 1 && a.sig) {
          // Named apart from the `want` above: `var` is function-scoped, so reusing the name
          // reassigns the text being matched rather than introducing a binding, which is a trap
          // for whoever adds a rung below this one.
          var sigWant = a.sig.split('|')[0];
          var narrowed = hits.filter(function (h) { return classSig(h) === sigWant; });
          if (narrowed.length === 1) return { node: narrowed[0], via: 'text' };
        }
      }
      if (a.sig) {
        // The signature only, never the ordinal that follows it. `div.card|2` means "the third
        // element that looked like this AT CAPTURE TIME". If the pool has changed at all that
        // index points at whatever slid into the slot — the same positional defect the path
        // rung guards against one rung up. Indexing into a set we know has changed is a coin
        // flip, and a coin flip wearing a "moved" badge reads as "your element moved", which
        // invites one specific wrong conclusion rather than flagging doubt. A comment we cannot
        // place goes to Orphaned, where the copy is true and nothing is lost.
        //
        // The ordinal is still WRITTEN by describe() and is part of the persisted anchor shape
        // (§3). It is reserved, not removed: dropping it from the format is a separate change
        // and files in the wild carry it.
        var want2 = a.sig.split('|')[0];
        var tag = want2.split('.')[0];
        var pool = [];
        var list = qsa(tag);
        for (var j = 0; j < list.length; j++) {
          if (isOurs(list[j])) continue;
          if (classSig(list[j]) === want2) pool.push(list[j]);
        }
        if (pool.length === 1) return { node: pool[0], via: 'sig' };
      }
      return null;
    }

    // --- rewrites: changing the page's own text -------------------------------
    //
    // A rewrite is a comment that also carries new text for the element it is anchored to.
    // Nothing about it is baked into the saved markup: save rung 1-3 writes the document's
    // ORIGINAL bytes back with only the island replaced, so the retyped wording lives in the
    // island and is re-applied here on every load. That is the same rule anchors follow, and
    // it is why a rewritten deck can still be reverted to the author's words.

    // Only a text LEAF may be rewritten: one with no element children, so that setting its
    // text cannot destroy structure. An element wrapping a chart, a table or three spans is
    // not something a reviewer can retype in a textarea without losing part of the page.
    var NOT_TEXT = /^(?:script|style|textarea|input|select|option|img|br|hr|svg|canvas|video|audio|iframe)$/;

    function textLeaf(node) {
      if (!node || node.nodeType !== 1 || isOurs(node)) return false;
      if (NOT_TEXT.test(node.tagName.toLowerCase())) return false;
      if (node.children && node.children.length > 0) return false;
      if (node.isContentEditable) return false;
      return visibleText(node) !== '';
    }

    function setText(node, value) {
      try { node.textContent = value; return true; }
      catch (err) { log('could not rewrite the text of an element', err); return false; }
    }

    // Applied in createdAt order, BEFORE any pin is resolved, and that order is load-bearing
    // twice over.
    //
    // Against the file: the page starts every load showing the author's original words, so the
    // first rewrite on an element finds the text its anchor recorded and corroborates against
    // it. Two successive rewrites of one element chain correctly — the second recorded "what
    // it said after the first", which is exactly what it now finds.
    //
    // Against later comments: a note written on an element AFTER someone retyped it recorded
    // the new wording as its quote. Resolve pins first and that note looks orphaned, because
    // the page is still showing the old text at that moment. Replaying the rewrites first
    // reconstitutes the document the later reviewer was actually looking at.
    var rewriteReport = { applied: 0, missing: 0, conflicts: [] };

    function applyRewrites() {
      rewriteReport = { applied: 0, missing: 0, conflicts: [] };
      comments
        .filter(rewriteShown)
        // A total order, which the previous form was not: never returning 0 told the sort that
        // (x,y) and (y,x) were BOTH greater, so two rewrites of one element minted in the same
        // millisecond — one reviewer pressing Cmd+Enter twice — were ordered by whatever the
        // engine happened to do. Returning 0 leaves the incoming order, which `merge` has
        // already sorted by time, to break the tie deterministically.
        .sort(function (x, y) {
          var a = String(x.createdAt), b = String(y.createdAt);
          return a < b ? -1 : a > b ? 1 : 0;
        })
        .forEach(function (c) {
          // Either state is legitimate here: the element still says `from` on a fresh load, and
          // says `to` when this runs again after the rewrite is already on the page (an import,
          // or a second pass). Try the unapplied state first, since that is the ordinary one.
          var hit = resolveAnchor(c.anchor, c.rewrite.from) || resolveAnchor(c.anchor, c.rewrite.to);
          if (!hit) { rewriteReport.missing++; return; }
          // textContent, not visibleText. A rewrite is written to textContent, so it has to be
          // read back from textContent or the two are not the same quantity: visibleText goes
          // through innerText, which returns the RENDERED text, and on an element carrying
          // text-transform:uppercase that never equals the wording that was stored. Comparing
          // the two reported every such rewrite as a conflict with the author's own markup.
          var live = collapse(hit.node.textContent);
          var want = collapse(c.rewrite.to);
          if (live === want) { rewriteReport.applied++; return; }
          // The element is there and says neither what this rewrite expected nor what it
          // asked for. Someone edited the source under the feedback. Applying it anyway is
          // the right call — it is what the reviewer asked for and it stays revertable — but
          // it is reported, because quietly overwriting an author's later change is how a
          // review tool loses someone's work.
          var expected = collapse(c.rewrite.from);
          if (live !== expected) rewriteReport.conflicts.push({ id: c.id, found: live });
          if (setText(hit.node, c.rewrite.to)) rewriteReport.applied++;
        });
    }

    // Putting the author's words back. The original is never dropped from the record, so this
    // is always available, even for a rewrite made by someone else three reviewers ago.
    function revertRewrite(c, done) {
      if (!c.rewrite) return;
      // The page is showing `to` at this point, which is what the element is found by.
      var hit = resolveAnchor(c.anchor, c.rewrite.to) || resolveAnchor(c.anchor, c.rewrite.from);

      // Clearing the record is conditional on having actually put the text back. `from` is the
      // only surviving evidence of the author's original wording once the page shows someone
      // else's, so dropping it on an element we could not find deletes that evidence and
      // restores nothing — and the old unconditional version then said "Text put back", which
      // was a claim about a page it had not touched.
      if (!hit || !setText(hit.node, c.rewrite.from)) {
        toast('That element is not on the page any more, so its text could not be put back. ' +
          'The original wording is kept in the comment.', { bad: true, ms: 7000 });
        return;
      }

      // Held for Undo, the way removeComment holds a deleted comment. A rewrite can be a
      // reviewer's entire contribution — the composer allows one with no note at all — and
      // "Put text back" sits in a row next to Resolve and Delete, so it gets misread as
      // "dismiss this". Destroying someone's proposed wording on one click with no way back
      // is the thing that row should never be able to do.
      var undone = c.rewrite;
      c.rewrite = null;
      c.updatedAt = nowISO();
      persist();
      toast('Text put back.' + WORDS.then, {
        actionLabel: 'Undo',
        action: function () {
          c.rewrite = undone;
          c.updatedAt = nowISO();
          var again = resolveAnchor(c.anchor, c.rewrite.from) || resolveAnchor(c.anchor, c.rewrite.to);
          if (again) setText(again.node, c.rewrite.to);
          persist();
          if (done) done();
        },
        ms: 8000
      });
      if (done) done();
    }

    // ===========================================================================
    // 4. Shell: host, theme, CSS
    // ===========================================================================

    var hostDiv = el('div');
    hostDiv.id = 'fbw-host';
    // position:fixed opens its own stacking context even with no z-index, so the
    // large z-indexes inside the shadow root only rank against each other. The
    // z-index HERE, on the outermost box, is what lifts the whole widget above a
    // page whose own slides carry z-index:1. Removing it makes the rail vanish
    // behind the deck in a way that looks like the script never ran.
    hostDiv.setAttribute('style',
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;');
    hostDiv.setAttribute('aria-hidden', 'false');

    var theme = { accent: '#2563eb', onAccent: '#ffffff', dark: false };

    function parseColor(v) {
      if (!v) return null;
      var probe = el('span');
      probe.style.cssText = 'display:none';
      probe.style.color = '';
      probe.style.color = v;
      if (!probe.style.color) return null;
      doc.body.appendChild(probe);
      var resolved = getComputedStyle(probe).color;
      probe.remove();
      var m = /rgba?\(([^)]+)\)/.exec(resolved);
      if (!m) return null;
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      if (p.length < 3 || p.some(isNaN)) return null;
      if (p.length > 3 && p[3] === 0) return null;
      return { r: p[0], g: p[1], b: p[2] };
    }

    function luminance(c) {
      function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    }

    function contrastText(c) { return luminance(c) > 0.45 ? '#111418' : '#ffffff'; }

    // Pages name their brand colour in many different ways. Probing a short list of common
    // custom-property names beats hardcoding one; --fbw-accent always wins.
    function detectTheme() {
      var t = { accent: null, onAccent: '#ffffff', dark: false };
      var probes = ['--fbw-accent', '--c-green', '--accent', '--green', '--c-accent',
        '--brand', '--primary', '--color-primary'];
      var cs = getComputedStyle(root);
      var chosen = cfg.accent;
      if (!chosen) {
        for (var i = 0; i < probes.length; i++) {
          var v = (cs.getPropertyValue(probes[i]) || '').trim();
          if (v && parseColor(v)) { chosen = v; break; }
        }
      }
      var bg = parseColor(getComputedStyle(doc.body).backgroundColor)
        || parseColor(getComputedStyle(root).backgroundColor);
      t.dark = bg ? luminance(bg) < 0.35 : window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (!chosen) chosen = t.dark ? '#4f9bea' : '#2563eb';
      var rgb = parseColor(chosen);
      t.accent = chosen;
      t.onAccent = rgb ? contrastText(rgb) : '#ffffff';
      return t;
    }

    var CSS = [
      ':host{all:initial;}',
      '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}',

      /* rail */
      '.rail{position:fixed;display:flex;flex-direction:column-reverse;align-items:center;gap:8px;',
      '  z-index:10;}',
      '.rail.br{right:24px;bottom:24px;}.rail.bl{left:24px;bottom:24px;}',
      '.fab{width:48px;height:48px;border-radius:50%;border:none;background:var(--a);color:var(--on);',
      '  font-size:26px;line-height:1;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28);',
      '  display:flex;align-items:center;justify-content:center;position:relative;transition:transform .12s;}',
      '.fab:hover{transform:scale(1.06);}',
      '.fab:focus-visible,.act:focus-visible{outline:3px solid var(--a);outline-offset:3px;}',
      '.acts{display:flex;flex-direction:column-reverse;gap:8px;opacity:0;pointer-events:none;',
      '  transform:translateY(6px);transition:opacity .14s,transform .14s;}',
      '.rail:hover .acts,.rail:focus-within .acts,.rail.open .acts{opacity:1;pointer-events:auto;transform:none;}',
      '.act{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:var(--surf);',
      '  color:var(--fg);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;',
      '  box-shadow:0 4px 14px rgba(0,0,0,.2);position:relative;}',
      '.act:hover{border-color:var(--a);}',
      '.act .n{font-size:13px;font-weight:700;}',
      '.dot{position:absolute;top:-1px;right:-1px;width:11px;height:11px;border-radius:50%;',
      '  background:#e8641c;border:2px solid var(--surf);}',
      '.tip{position:absolute;right:52px;top:50%;transform:translateY(-50%);background:#14181d;color:#fff;',
      '  padding:5px 9px;border-radius:6px;font-size:12px;white-space:nowrap;opacity:0;pointer-events:none;',
      '  transition:opacity .12s;}',
      '.rail.bl .tip{right:auto;left:52px;}',
      '.act:hover .tip,.act:focus-visible .tip{opacity:1;}',

      /* pins */
      '.pin{position:fixed;top:0;left:0;min-width:24px;height:24px;padding:0 6px;border-radius:12px;',
      '  background:var(--a);color:var(--on);font-size:12px;font-weight:700;border:2px solid #fff;',
      '  display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9;',
      '  box-shadow:0 2px 8px rgba(0,0,0,.35);will-change:transform;}',
      '.pin.done{background:#7b8794;}',
      // The badge is the entire safety argument for demoting an uncertain match rather than
      // accepting it: a dashed 2px border on a 24px circle is not legible at a glance, so the
      // ring is what actually carries the signal.
      '.pin.moved{border-style:dashed;border-color:#f0b429;',
      '  box-shadow:0 0 0 2px rgba(240,180,41,.55),0 2px 8px rgba(0,0,0,.35);}',
      '.pin:focus-visible{outline:3px solid var(--a);outline-offset:2px;}',

      /* panels */
      '.panel{position:fixed;width:340px;max-width:calc(100vw - 32px);max-height:min(72vh,620px);',
      '  display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border:1px solid var(--line);',
      '  border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.35);z-index:12;font-size:13px;overflow:hidden;}',
      '.ph{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;',
      '  border-bottom:1px solid var(--line);font-weight:650;font-size:13px;flex:0 0 auto;}',
      '.ph>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}',
      '.panel:focus{outline:none;}',
      '.pb{padding:11px 12px;overflow:auto;flex:1 1 auto;}',
      '.x{background:none;border:none;color:var(--mut);font-size:17px;line-height:1;cursor:pointer;padding:2px 4px;}',
      '.x:hover{color:var(--fg);}',
      'textarea{width:100%;min-height:78px;max-height:240px;border:1px solid var(--line);border-radius:8px;',
      '  padding:8px;font-size:13px;font-family:inherit;line-height:1.45;resize:vertical;background:var(--surf);',
      '  color:var(--fg);}',
      'textarea:focus{outline:2px solid var(--a);outline-offset:-1px;}',
      'input[type=text]{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 8px;',
      '  font-size:13px;background:var(--surf);color:var(--fg);font-family:inherit;}',
      '.row{display:flex;gap:7px;flex-wrap:wrap;align-items:center;}',
      '.row.end{justify-content:flex-end;}',
      '.mt{margin-top:9px;}',
      '.b{border:1px solid var(--line);background:var(--surf);color:var(--fg);border-radius:7px;',
      '  padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit;}',
      '.b:hover{border-color:var(--a);}',
      '.b.pri{background:var(--a);border-color:var(--a);color:var(--on);font-weight:600;}',
      '.b.q{border-color:transparent;background:none;color:var(--mut);padding:6px 6px;}',
      '.b.q:hover{color:var(--fg);}',
      '.b:focus-visible{outline:3px solid var(--a);outline-offset:2px;}',

      /* comment rows */
      '.item{padding:9px 0;border-bottom:1px solid var(--line);}',
      '.item:last-child{border-bottom:none;}',
      '.meta{color:var(--mut);font-size:11px;margin-bottom:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}',
      '.badge{border:1px solid var(--line);border-radius:999px;padding:0 6px;font-size:10px;line-height:15px;}',
      '.badge.w{border-color:#f0b429;color:#b07d0a;}',
      '.badge.acc{border-color:var(--a);color:var(--a);}',
      '.txt{white-space:pre-wrap;word-break:break-word;line-height:1.5;margin-bottom:7px;}',
      /* a rewrite, shown as what it said over what it says now */
      '.diff{font-size:11.5px;line-height:1.45;margin-bottom:7px;}',
      '.diff .was{color:var(--mut);text-decoration:line-through;word-break:break-word;}',
      '.diff .now{word-break:break-word;}',
      '.lbl{font-size:11px;font-weight:700;color:var(--mut);margin-top:9px;}',
      'textarea.te{min-height:52px;}',
      '.item.res .txt{opacity:.55;text-decoration:line-through;}',
      '.sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);',
      '  margin:12px 0 5px;}',
      '.empty{color:var(--mut);font-style:italic;padding:8px 0;}',
      '.note{color:var(--mut);font-size:11px;line-height:1.45;margin-top:5px;}',
      '.warn{background:rgba(240,180,41,.14);border:1px solid rgba(240,180,41,.5);border-radius:8px;',
      '  padding:7px 9px;font-size:11.5px;line-height:1.45;margin-bottom:9px;}',

      /* picker */
      '.scrim{position:fixed;inset:0;background:rgba(10,14,20,.28);z-index:6;pointer-events:none;}',
      '.hl{position:fixed;top:0;left:0;border:2px solid var(--a);border-radius:4px;z-index:7;',
      '  pointer-events:none;background:rgba(255,255,255,.07);will-change:transform,width,height;}',
      '.chip{position:fixed;top:0;left:0;z-index:8;display:flex;align-items:center;gap:6px;background:#14181d;',
      '  color:#fff;border-radius:7px;padding:4px 6px;font-size:11.5px;box-shadow:0 4px 14px rgba(0,0,0,.4);}',
      '.chip button{width:20px;height:20px;border-radius:4px;border:1px solid rgba(255,255,255,.28);',
      '  background:none;color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0;}',
      '.chip .lab{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.hint{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:#14181d;color:#fff;',
      '  padding:8px 15px;border-radius:999px;font-size:12.5px;z-index:11;pointer-events:none;',
      '  box-shadow:0 6px 20px rgba(0,0,0,.4);max-width:92vw;text-align:center;}',

      /* toast + modal */
      '.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(8px);background:#14181d;',
      '  color:#fff;padding:10px 16px;border-radius:999px;font-size:12.5px;z-index:14;opacity:0;',
      '  transition:opacity .18s,transform .18s;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.4);',
      '  display:flex;align-items:center;gap:10px;max-width:92vw;}',
      '.toast.on{opacity:1;transform:translateX(-50%);pointer-events:auto;}',
      '.toast.bad{background:#7f1d1d;}',
      '.toast button{background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:6px;',
      '  padding:3px 9px;font-size:11.5px;cursor:pointer;font-family:inherit;}',
      '.modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:320px;max-width:calc(100vw - 32px);',
      '  background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:15px;',
      '  z-index:15;box-shadow:0 18px 50px rgba(0,0,0,.45);font-size:13px;}',
      '.modal p{margin-bottom:12px;line-height:1.5;}',
      '.veil{position:fixed;inset:0;background:rgba(6,9,13,.42);z-index:13;}',

      '@media print{.rail,.pin,.panel,.toast,.modal,.veil,.hint,.chip,.hl,.scrim{display:none !important;}}',
      '@media (prefers-reduced-motion:reduce){*{transition:none !important;}}'
    ].join('\n');

    var shadow, ui_;

    // ===========================================================================
    // 5. Chrome: toast, confirm, focus trap
    // ===========================================================================

    var toastEl, toastTimer;

    function toast(msg, opts) {
      opts = opts || {};
      if (!toastEl) { toastEl = el('div', 'toast'); ui_.appendChild(toastEl); }
      toastEl.textContent = '';
      toastEl.appendChild(el('span', null, msg));
      toastEl.classList.toggle('bad', !!opts.bad);
      if (opts.actionLabel && opts.action) {
        var b = el('button', null, opts.actionLabel);
        b.type = 'button';
        b.addEventListener('click', function () { hideToast(); opts.action(); });
        toastEl.appendChild(b);
      }
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, opts.ms || (opts.action ? 7000 : 3400));
    }
    function hideToast() { if (toastEl) toastEl.classList.remove('on'); }

    var modal = null;

    // `dismissed` means the dialog went away WITHOUT the reviewer choosing one of its
    // buttons: Escape, a veil click, being replaced by another dialog, or teardown. Any code
    // waiting on an answer has to be told, or it waits forever. That is not hypothetical — a
    // save wrapped this in a promise that only its two buttons could resolve, so pressing
    // Escape on the save dialog left `saving` true for the rest of the session and silently
    // swallowed every later Cmd+S.
    function closeModal(dismissed) {
      if (!modal) return;
      var m = modal;
      modal = null;
      m.veil.remove();
      m.box.remove();
      if (dismissed && m.onDismiss) {
        try { m.onDismiss(); } catch (err) { log('modal dismiss handler failed', err); }
      }
      var back = m.restore;
      if (back && back.focus) try { back.focus(); } catch (e) {}
    }

    // Buttons are [{label, primary, quiet, fn}]. Returning three choices rather
    // than two matters for the discard case: "Submit anyway" saves the reviewer's
    // typing instead of making Cancel the only escape from a full textarea.
    //
    // opts: { body, focus, restore, onDismiss }. `body` is an extra node between the message
    // and the buttons, which is what lets the identity prompt live on this layer instead of
    // mounting a second panel over the composer.
    function ask(message, buttons, opts) {
      opts = opts || {};
      // Replacing a pending dialog counts as dismissing it, in both directions: a save
      // dialog displaced by anything else really is abandoned, and an identity dialog
      // displaced by a save really does hand the reviewer back to their composer.
      closeModal(true);
      var veil = el('div', 'veil');
      var box = el('div', 'modal');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.appendChild(el('p', null, message));
      if (opts.body) box.appendChild(opts.body);
      var row = el('div', 'row end');
      buttons.forEach(function (spec) {
        var b = el('button', 'b' + (spec.primary ? ' pri' : '') + (spec.quiet ? ' q' : ''), spec.label);
        b.type = 'button';
        b.addEventListener('click', function () { closeModal(false); if (spec.fn) spec.fn(); });
        row.appendChild(b);
      });
      box.appendChild(row);
      veil.addEventListener('click', function () { closeModal(true); });
      ui_.appendChild(veil);
      ui_.appendChild(box);
      modal = {
        veil: veil, box: box,
        restore: Object.prototype.hasOwnProperty.call(opts, 'restore') ? opts.restore : (shadow.activeElement || null),
        onDismiss: opts.onDismiss || null
      };
      var first = opts.focus || box.querySelector('button.pri') || box.querySelector('button');
      if (first) first.focus();
    }

    // Tab must not escape an open panel into the host page. activeElement has to
    // be read off the shadow root; document.activeElement only ever reports the
    // host element and makes the trap silently do nothing.
    function trapTab(e, container) {
      if (e.key !== 'Tab') return;
      var f = container.querySelectorAll('button,textarea,input,select,a[href],[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var list = Array.prototype.filter.call(f, function (n) { return n.offsetParent !== null || n === shadow.activeElement; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      var cur = shadow.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }

    // ===========================================================================
    // 6. Picker
    // ===========================================================================

    var picking = false;
    var hoverNode = null;
    var depth = 0;
    var pickRaf = null;
    var scrim, hl, chip, hintEl;
    var kbIndex = -1, kbList = null;
    var restoreFocus = null;

    function chainOf(node) {
      var c = [];
      var n = node;
      while (n && n !== doc.body && n !== root) { c.push(n); n = n.parentElement; }
      return c;
    }
    function atDepth(node, d) {
      var c = chainOf(node);
      if (!c.length) return node;
      return c[Math.max(0, Math.min(d, c.length - 1))];
    }

    function nodeAt(x, y) {
      var n = doc.elementFromPoint(x, y);
      return (!n || isOurs(n)) ? null : n;
    }

    function startPick() {
      if (picking) return;
      picking = true;
      hoverNode = null; depth = 0; kbIndex = -1; kbList = null;
      restoreFocus = shadow.activeElement;
      root.style.setProperty('cursor', 'crosshair', 'important');
      scrim = el('div', 'scrim'); ui_.appendChild(scrim);
      hintEl = el('div', 'hint');
      hintEl.textContent = 'Click anything to comment on it. [ and ] widen or narrow the selection. Tab steps through elements. Esc cancels.';
      ui_.appendChild(hintEl);
      // Capture phase throughout: several host pages call stopPropagation() on
      // capture for their own modal handling, and a bubble-phase picker is
      // silently swallowed on those pages.
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('click', onPick, true);
      doc.addEventListener('keydown', onPickKey, true);
      render();
      callback('onOpen');
    }

    function stopPick() {
      if (!picking) return;
      picking = false;
      // A queued highlight redraw from the same frame as the closing click would
      // otherwise paint a stray outline a moment after picking ended.
      if (pickRaf) { cancelAnimationFrame(pickRaf); pickRaf = null; }
      root.style.removeProperty('cursor');
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('click', onPick, true);
      doc.removeEventListener('keydown', onPickKey, true);
      [scrim, hl, chip, hintEl].forEach(function (n) { if (n) n.remove(); });
      scrim = hl = chip = hintEl = null;
      hoverNode = null;
      if (restoreFocus && restoreFocus.focus) try { restoreFocus.focus(); } catch (e) {}
      render();
      callback('onClose');
    }

    function onMove(e) {
      if (!picking || pickRaf) return;
      var x = e.clientX, y = e.clientY;
      pickRaf = requestAnimationFrame(function () {
        pickRaf = null;
        var n = nodeAt(x, y);
        if (!n) return;
        if (n !== hoverNode) { hoverNode = n; depth = 0; kbIndex = -1; }
        paintTarget(atDepth(hoverNode, depth));
      });
    }

    function paintTarget(node) {
      if (!node) return;
      var r = node.getBoundingClientRect();
      if (!hl) { hl = el('div', 'hl'); ui_.appendChild(hl); }
      hl.style.transform = 'translate(' + Math.round(r.left) + 'px,' + Math.round(r.top) + 'px)';
      hl.style.width = Math.max(2, Math.round(r.width)) + 'px';
      hl.style.height = Math.max(2, Math.round(r.height)) + 'px';

      if (!chip) {
        chip = el('div', 'chip');
        var narrow = el('button', null, '\u25c2'); narrow.type = 'button';
        narrow.title = 'Narrow selection ([)';
        narrow.addEventListener('click', function (ev) { ev.stopPropagation(); step(-1); });
        var lab = el('span', 'lab');
        var wide = el('button', null, '\u25b8'); wide.type = 'button';
        wide.title = 'Widen selection (])';
        wide.addEventListener('click', function (ev) { ev.stopPropagation(); step(1); });
        chip.appendChild(narrow); chip.appendChild(lab); chip.appendChild(wide);
        ui_.appendChild(chip);
      }
      var name = node.tagName.toLowerCase() + (node.id ? '#' + node.id : '');
      var t = visibleText(node).slice(0, 34);
      chip.querySelector('.lab').textContent = t ? name + ' \u2014 ' + t : name;
      var cy = r.top > 34 ? r.top - 30 : Math.min(innerHeight - 30, r.bottom + 6);
      chip.style.transform = 'translate(' + Math.round(Math.max(4, Math.min(r.left, innerWidth - 260))) + 'px,' + Math.round(cy) + 'px)';
    }

    function step(dir) {
      if (!hoverNode) return;
      var c = chainOf(hoverNode);
      depth = Math.max(0, Math.min(c.length - 1, depth + dir));
      paintTarget(atDepth(hoverNode, depth));
    }

    // Keyboard-only picking. Without this the entire tool is mouse-gated, which
    // is not acceptable for something shipped to everyone.
    function buildKbList() {
      var sel = 'h1,h2,h3,h4,h5,h6,p,li,td,th,figure,table,section,article,blockquote,img,svg,button,a';
      var out = [];
      var all = qsa(sel);
      for (var i = 0; i < all.length; i++) {
        var n = all[i];
        if (isOurs(n)) continue;
        var r = n.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        out.push(n);
      }
      return out;
    }

    function onPickKey(e) {
      if (!picking) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPick(); return; }
      if (e.key === ']' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); step(1); return; }
      if (e.key === '[' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); step(-1); return; }
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (!kbList) kbList = buildKbList();
        if (!kbList.length) return;
        kbIndex = (kbIndex + (e.shiftKey ? -1 : 1) + kbList.length) % kbList.length;
        hoverNode = kbList[kbIndex]; depth = 0;
        try { hoverNode.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (err) {}
        paintTarget(hoverNode);
        return;
      }
      if (e.key === 'Enter' && hoverNode) {
        e.preventDefault(); e.stopPropagation();
        choose(atDepth(hoverNode, depth));
      }
    }

    function onPick(e) {
      if (!picking) return;
      var n = nodeAt(e.clientX, e.clientY);
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      choose(atDepth(n, depth));
    }

    function choose(node) {
      if (!node) return;
      var r = node.getBoundingClientRect();
      var anchor = describe(node);
      stopPick();
      openComposer(anchor, r, node);
    }

    // Touch: a long press stands in for hover-then-click.
    var touchTimer = null;
    function wireTouch() {
      on(doc, 'touchstart', function (e) {
        if (picking || !e.touches || e.touches.length !== 1) return;
        var t = e.touches[0];
        touchTimer = setTimeout(function () {
          var n = nodeAt(t.clientX, t.clientY);
          if (n) { startPick(); hoverNode = n; depth = 0; paintTarget(n); }
        }, 550);
      }, { passive: true, capture: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach(function (type) {
        on(doc, type, function () { clearTimeout(touchTimer); }, { passive: true, capture: true });
      });
    }

    // ===========================================================================
    // 7. Pins
    // ===========================================================================

    var pinEls = {};
    var groups = [];
    var orphans = [];

    // Grouping by resolved element rather than by anchor string means two
    // comments that ended up with different descriptions of the same element
    // still share one pin instead of stacking two on the same pixel.
    function computeGroups() {
      var found = [];
      var lost = [];
      var byNode = [];
      comments.forEach(function (c) {
        // A rewritten element says `to` now, not what the anchor recorded. Unless the page put
        // its own words back: a framework that re-renders (React, Vue) overwrites the text it
        // owns, and the rewrite could not be applied at all on an element that changed. The
        // element saying `from` is still the element the comment is about, so look for that
        // before calling it lost.
        var hit = resolveAnchor(c.anchor, c.rewrite ? c.rewrite.to : null)
          || (c.rewrite ? resolveAnchor(c.anchor, c.rewrite.from) : null);
        if (!hit) { lost.push(c); return; }
        var slot = null;
        for (var i = 0; i < byNode.length; i++) if (byNode[i].node === hit.node) { slot = byNode[i]; break; }
        if (!slot) { slot = { node: hit.node, via: hit.via, items: [] }; byNode.push(slot); found.push(slot); }
        if (hit.via !== 'id' && hit.via !== 'path') slot.via = hit.via;
        slot.items.push(c);
      });
      found.forEach(function (g, i) { g.key = 'g' + i; });
      groups = found;
      orphans = lost;
    }

    function visibleRect(node) {
      var r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      if (r.bottom < -60 || r.top > innerHeight + 60) return null;
      if (r.right < -60 || r.left > innerWidth + 60) return null;
      var cs = getComputedStyle(node);
      if (cs.visibility === 'hidden' || cs.display === 'none') return null;
      return r;
    }

    function renderPins() {
      computeGroups();
      var seen = {};
      var hidden = ui.pinsHidden === true;

      groups.forEach(function (g) {
        seen[g.key] = 1;
        var pin = pinEls[g.key];
        if (!pin) {
          pin = el('button', 'pin');
          pin.type = 'button';
          pin.addEventListener('click', function (ev) {
            ev.stopPropagation();
            openThread(g.key);
          });
          ui_.appendChild(pin);
          pinEls[g.key] = pin;
        }
        pin.textContent = String(g.items.length);
        var allDone = g.items.every(function (c) { return c.resolved; });
        pin.classList.toggle('done', allDone);
        pin.classList.toggle('moved', g.via !== 'id' && g.via !== 'path');
        pin.setAttribute('aria-label',
          plural(g.items.length, 'comment', 'comments') + ' on ' + (g.node.tagName.toLowerCase()) +
          (allDone ? ', all resolved' : ''));

        if (hidden) { pin.style.display = 'none'; return; }
        var r = visibleRect(g.node);
        if (!r) { pin.style.display = 'none'; return; }
        pin.style.display = 'flex';
        // Clamp to the viewport on both axes. A pin anchored to a very wide or
        // very tall element otherwise lands off-screen — drawn, but invisible,
        // which looks exactly like the comment never registered.
        //
        // Anchored to the element's LEADING edge, not its trailing one. A block
        // element's box runs the full column width while its text is ragged and
        // often ends a couple of hundred pixels short, so a pin on the right edge
        // floats in empty space with no visible tie to the words it is about.
        // Sitting just outside the left edge puts it beside the first word.
        // That also buys back the vertical room: off to the side, the pin no
        // longer has to be lifted clear of the first line, so it sits level with
        // the text instead of overlapping it.
        var x = Math.max(2, Math.min(r.left - 14, innerWidth - 30));
        var y = Math.max(2, Math.min(r.top - 2, innerHeight - 30));
        pin.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      });

      Object.keys(pinEls).forEach(function (k) {
        if (!seen[k]) { pinEls[k].remove(); delete pinEls[k]; }
      });
    }

    var posRaf = null;
    function schedulePins() {
      if (posRaf) return;
      posRaf = requestAnimationFrame(function () { posRaf = null; renderPins(); });
    }

    function groupByKey(key) {
      for (var i = 0; i < groups.length; i++) if (groups[i].key === key) return groups[i];
      return null;
    }

    // ===========================================================================
    // 8. Panels
    // ===========================================================================

    var panel = null;

    function closePanel(checkUnsaved) {
      if (!panel) return;
      if (checkUnsaved && panel.unsaved && panel.unsaved()) {
        var pending = panel;
        ask('You have an unfinished comment. Discard it?', [
          { label: 'Keep editing', quiet: true },
          { label: 'Submit anyway', fn: function () { if (pending.submit) pending.submit(); } },
          { label: 'Discard', primary: true, fn: function () { panel = pending; dropPanel(); } }
        ]);
        return;
      }
      dropPanel();
    }
    function dropPanel() {
      if (!panel) return;
      var back = panel.restore;
      panel.node.remove();
      panel = null;
      if (back && back.focus) try { back.focus(); } catch (e) {}
      render();
    }

    function makePanel(title, onClose) {
      var p = el('div', 'panel');
      p.setAttribute('role', 'dialog');
      p.setAttribute('aria-label', title);
      // Focus lands on the dialog itself, not on its first button. Focusing the
      // close button puts a focus ring on it, which reads as "this is the
      // suggested action" when the suggested action is to read the comment.
      p.setAttribute('tabindex', '-1');
      var h = el('div', 'ph');
      h.appendChild(el('span', null, title));
      var x = el('button', 'x', '\u2715');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', onClose);
      h.appendChild(x);
      p.appendChild(h);
      p.appendChild(el('div', 'pb'));
      p.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        trapTab(e, p);
      });
      return p;
    }

    function placeNear(p, rect) {
      var m = 12, w = 340, h = Math.min(innerHeight * 0.72, 620);
      var left = rect ? rect.right + m : innerWidth - w - m;
      if (left + w > innerWidth - m) left = (rect ? rect.left : innerWidth) - w - m;
      left = Math.max(m, Math.min(left, innerWidth - w - m));
      var top = rect ? rect.top : m;
      top = Math.max(m, Math.min(top, innerHeight - h - m));
      p.style.left = Math.round(left) + 'px';
      p.style.top = Math.round(top) + 'px';
    }

    function placeCorner(p) {
      var m = 24;
      p.style.bottom = (m + 56) + 'px';
      p.style.top = 'auto';
      if (cfg.position === 'bottom-left') p.style.left = m + 'px';
      else p.style.left = Math.max(12, innerWidth - 340 - m) + 'px';
    }

    function mountPanel(p, unsaved, submit) {
      ui_.appendChild(p);
      panel = { node: p, unsaved: unsaved || null, submit: submit || null, restore: shadow.activeElement };
      render();
    }

    // --- identity -------------------------------------------------------------

    // Asked once, on the reviewer's first comment, which means it always appears on top of an
    // open composer holding text they have already typed.
    //
    // It used to mount a second PANEL. `mountPanel` overwrites the module-level `panel`
    // without removing the node it replaces, so the composer stayed on screen — live, still
    // able to post, and unreachable, because `panel` no longer pointed at it. Two identical
    // 340px dialogs, one of them a ghost that posted a duplicate when clicked.
    //
    // On the modal layer the bug is unrepresentable rather than merely avoided: `.veil`
    // (z-index 13) sits above `.panel` (12) and takes pointer events, so the composer cannot
    // be touched while this is up. Dismissing lifts the veil and hands the reviewer straight
    // back to their half-written comment — it does not post anonymously and does not discard.
    function ensureAuthor(next) {
      var known = getAuthor();
      if (known || ui.anonymous) { next(known); return; }

      var body = el('div');
      var input = doc.createElement('input');
      input.type = 'text';
      input.placeholder = 'Your name';
      input.setAttribute('aria-label', 'Your name');
      body.appendChild(input);
      body.appendChild(el('div', 'note',
        'Shown next to your comments so a deck reviewed by several people stays readable. Stored only in this browser.'));

      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var go = modal && modal.box.querySelector('button.pri');
        if (go) go.click();
      });

      // Not shadow.activeElement: at this point that is the composer's "Add comment" button,
      // so restoring to it leaves Enter re-opening this dialog. Send focus back to the text —
      // the COMMENT field by class, not the first textarea, which on a text-leaf element is
      // the page's own wording sitting above it.
      var composerText = panel && panel.node
        ? (panel.node.querySelector('textarea.cmt') || panel.node.querySelector('textarea'))
        : null;

      ask('Who is leaving feedback?', [
        { label: 'Stay anonymous', quiet: true, fn: function () {
          ui.anonymous = true; saveUi(); next(null);
        } },
        { label: 'Continue', primary: true, fn: function () {
          var name = input.value.trim();
          var who = name ? { name: name.slice(0, 120), email: null } : null;
          if (who) setAuthor(who); else { ui.anonymous = true; saveUi(); }
          next(who);
        } }
      ], {
        body: body,
        focus: input,
        restore: composerText,
        // Dismissed without answering: the comment is not posted and not thrown away. The
        // composer was only ever veiled, so there is nothing to rebuild.
        onDismiss: null
      });
    }

    // --- composer -------------------------------------------------------------

    function openComposer(anchor, rect, node) {
      var p = makePanel('New comment', function () { closePanel(true); });
      var body = p.querySelector('.pb');
      var label = (anchor.aria || (anchor.quote && anchor.quote.exact) || anchor.tag || '').slice(0, 70);
      if (label) body.appendChild(el('div', 'note', 'On: ' + label));

      // The element's own words, there to be retyped. Shown as the page renders them —
      // collapsed and trimmed — rather than as the raw markup, which carries the source file's
      // indentation and would put the author's whitespace in front of the reviewer to edit.
      // The exact original is kept separately, so Revert restores the markup as it was.
      var editable = cfg.textEdits && textLeaf(node);
      var was = editable ? visibleText(node) : '';
      var rawWas = editable ? node.textContent : '';
      var te = null;
      if (editable) {
        body.appendChild(el('div', 'lbl', 'Text on the page'));
        te = doc.createElement('textarea');
        te.className = 'mt te';
        te.value = was;
        te.setAttribute('aria-label', 'The text of this element, editable');
        body.appendChild(te);
        body.appendChild(el('div', 'note', 'Change this to rewrite it on the page. The original wording is kept, so it can be put back.'));
      }

      if (editable) body.appendChild(el('div', 'lbl', 'Comment'));
      var ta = doc.createElement('textarea');
      ta.className = 'mt cmt';
      ta.placeholder = editable ? 'Why it should change (optional if you retyped it above)' : 'What should change here?';
      ta.setAttribute('aria-label', 'Comment text');
      body.appendChild(ta);
      var row = el('div', 'row end mt');
      var cancel = el('button', 'b q', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { closePanel(true); });
      var send = el('button', 'b pri', 'Add comment');
      send.type = 'button';
      row.appendChild(cancel); row.appendChild(send);
      body.appendChild(row);
      body.appendChild(el('div', 'note', WORDS.composerNote));

      function changedText() {
        if (!te) return null;
        var now = te.value.trim();
        return now && now !== was ? now : null;
      }

      function submit() {
        var text = ta.value.trim();
        var rewritten = changedText();
        // Either half is enough on its own. A reviewer who fixes a typo in a headline has said
        // everything they came to say, and demanding a note as well is how that edit gets
        // abandoned; a note with no edit is the ordinary case this tool started as.
        if (!text && !rewritten) {
          toast(te ? 'Retype the text above, or add a comment.' : 'Add some text first.', { bad: true });
          (te || ta).focus();
          return;
        }
        ensureAuthor(function (who) {
          var c = withContext(normalise({
            id: newId(),
            createdAt: nowISO(), updatedAt: nowISO(),
            author: who, text: clampText(text), resolved: false, originalText: null,
            toolBuild: toolBuild,
            rewrite: rewritten ? { from: rawWas, to: clampText(rewritten), at: nowISO() } : null,
            anchor: anchor
          }));
          comments.push(c);
          if (c.rewrite && node) setText(node, c.rewrite.to);
          dropPanel();
          persist();
          notifySubmit(c);
          toast(c.rewrite
            ? 'Text changed' + (text ? ' and comment added' : '') + '.' + WORDS.then
            : 'Comment added.' + WORDS.then);
        });
      }
      send.addEventListener('click', submit);
      function onKey(e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
      }
      ta.addEventListener('keydown', onKey);
      if (te) te.addEventListener('keydown', onKey);

      placeNear(p, rect);
      mountPanel(p, function () { return ta.value.trim().length > 0 || !!changedText(); }, submit);
      (te || ta).focus();
    }

    // --- a single comment row -------------------------------------------------

    function commentRow(c, refresh) {
      var item = el('div', 'item' + (c.resolved ? ' res' : ''));

      function view() {
        item.textContent = '';
        var meta = el('div', 'meta');
        meta.appendChild(el('span', null, (c.author && c.author.name) || 'Anonymous'));
        meta.appendChild(el('span', null, fmtWhen(c.createdAt)));
        if (c.originalText) meta.appendChild(el('span', 'badge', 'edited'));
        var shown = rewriteShown(c);
        if (c.rewrite) meta.appendChild(el('span', 'badge acc', shown ? 'text changed' : 'suggested text'));
        if (c.resolved) meta.appendChild(el('span', 'badge', 'resolved'));
        item.appendChild(meta);
        // The change itself, before the note: on a rewrite-only entry there is no note, and
        // the diff is the whole content of the row.
        if (c.rewrite) {
          var diff = el('div', 'diff');
          diff.appendChild(el('div', 'was', '“' + clip(collapse(c.rewrite.from), 120) + '”'));
          diff.appendChild(el('div', 'now', '“' + clip(collapse(c.rewrite.to), 120) + '”'));
          item.appendChild(diff);
        }
        if (c.text) item.appendChild(el('div', 'txt', c.text));
        var row = el('div', 'row');
        var edit = el('button', 'b q', 'Edit');
        edit.type = 'button'; edit.addEventListener('click', editing);
        var res = el('button', 'b q', c.resolved ? 'Reopen' : 'Resolve');
        res.type = 'button';
        res.addEventListener('click', function () {
          c.resolved = !c.resolved; c.updatedAt = nowISO(); persist(); refresh();
        });
        var del = el('button', 'b q', 'Delete');
        del.type = 'button';
        del.addEventListener('click', function () { removeComment(c, refresh); });
        row.appendChild(edit); row.appendChild(res); row.appendChild(del);
        if (c.rewrite && shown) {
          // Reverting the text is not deleting the comment: the note explaining why the
          // wording was wrong is usually the part worth keeping. Not offered on someone
          // else's suggestion that this page is not showing: there is nothing to put back.
          var back = el('button', 'b q', 'Put text back');
          back.type = 'button';
          back.addEventListener('click', function () { revertRewrite(c, refresh); });
          row.appendChild(back);
        }
        item.appendChild(row);
      }

      function editing() {
        item.textContent = '';
        var ta = doc.createElement('textarea');
        ta.value = c.text;
        ta.setAttribute('aria-label', 'Edit comment');
        item.appendChild(ta);
        var row = el('div', 'row end mt');
        var cancel = el('button', 'b q', 'Cancel');
        cancel.type = 'button'; cancel.addEventListener('click', view);
        var save = el('button', 'b pri', 'Save');
        save.type = 'button';
        save.addEventListener('click', function () {
          var v = ta.value.trim();
          if (!v) { toast('Comment cannot be empty.', { bad: true }); return; }
          if (c.originalText == null && v !== c.text) c.originalText = c.text;
          c.text = clampText(v);
          c.updatedAt = nowISO();
          persist(); refresh();
        });
        ta.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.click(); }
        });
        row.appendChild(cancel); row.appendChild(save);
        item.appendChild(row);
        ta.focus();
      }

      view();
      return item;
    }

    // Soft delete with an undo window. A misplaced click on Delete should not be
    // the end of somebody's paragraph of feedback.
    // Soft delete with an undo window. The tombstone is written NOW, not when the undo window
    // closes, and Undo takes it back again.
    //
    // It used to be the other way round, on an 8.2-second timer, which made a UI affordance
    // accidentally load-bearing for durability. The boot merge is island ∪ buffer, so until
    // the tombstone existed there was nothing to stop a comment that was already saved in the
    // file from walking straight back in: delete it, reload within eight seconds, and it
    // returned — with `dirty` false, so no dot, no unload guard, no signal of any kind.
    // Closing the tab inside the window lost the deletion permanently.
    function removeComment(c, refresh) {
      var idx = comments.indexOf(c);
      if (idx === -1) return;
      comments.splice(idx, 1);
      if (!tombstones.some(function (t) { return t.id === c.id; })) {
        tombstones.push({ id: c.id, deletedAt: nowISO() });
      }
      persist();
      if (refresh) refresh();
      toast('Comment deleted.', {
        actionLabel: 'Undo',
        action: function () {
          tombstones = tombstones.filter(function (t) { return t.id !== c.id; });
          comments.splice(Math.min(idx, comments.length), 0, c);
          persist();
          if (refresh) refresh();
        },
        ms: 8000
      });
    }

    // --- thread on one pin ----------------------------------------------------

    function openThread(key) {
      var g = groupByKey(key);
      if (!g) return;
      if (panel && panel.key === key) { closePanel(false); return; }
      closePanel(true);
      if (panel) return;
      var title = (labelFor(g.node) || visibleText(g.node).slice(0, 40) || g.node.tagName.toLowerCase());
      var p = makePanel(title, function () { closePanel(false); });
      function fill() {
        computeGroups();
        var live = groupByKey(key);
        var body = p.querySelector('.pb');
        body.textContent = '';
        var items = live ? live.items : [];
        if (!items.length) { body.appendChild(el('div', 'empty', 'No comments here any more.')); return; }
        if (live && live.via !== 'id' && live.via !== 'path') {
          body.appendChild(el('div', 'warn',
            'This element moved or changed since the comment was written. It was matched by its ' +
            (live.via === 'text' ? 'text' : 'shape') + ', so double-check it is the right spot.'));
        }
        items.forEach(function (c) { body.appendChild(commentRow(c, fill)); });
        var add = el('button', 'b mt', 'Add another comment here');
        add.type = 'button';
        add.addEventListener('click', function () {
          var rect = live.node.getBoundingClientRect();
          var anchor = describe(live.node);
          var target = live.node;
          dropPanel();
          openComposer(anchor, rect, target);
        });
        body.appendChild(add);
      }
      fill();
      placeNear(p, g.node.getBoundingClientRect());
      mountPanel(p);
      panel.key = key;
      panel.refresh = fill;
      p.focus();
    }

    // --- review list ----------------------------------------------------------

    function openReview() {
      if (panel && panel.isReview) { closePanel(false); return; }
      closePanel(true);
      if (panel) return;
      var p = makePanel('Review', function () { closePanel(false); });

      function fill() {
        computeGroups();
        var body = p.querySelector('.pb');
        body.textContent = '';

        // Where the comments stand with the server, always visible in server mode: "sent"
        // is the claim a reviewer needs before closing the tab, and it must be true.
        if (SERVER) {
          var st = syncStatus();
          body.appendChild(el('div', st.bad ? 'warn' : 'note', st.text));
        }

        if (storageBroken) {
          body.appendChild(el('div', 'warn',
            'This browser is blocking or has run out of local storage. ' + WORDS.storageLost));
        }
        if (bufferAhead > 0) {
          // State the fact and name the causes; do not assert the rarest one. Because docId
          // is a hash of the document's own text, every copy of a deck shares one storage
          // key, so the commonest cause is simply another copy of this document opened in
          // this browser — not a stale download. Telling the reviewer the file is old makes
          // them distrust content that is usually fine.
          body.appendChild(el('div', 'warn',
            plural(bufferAhead, 'comment', 'comments') + ' in this browser ' +
            (bufferAhead === 1 ? 'has' : 'have') + ' not been written into this file. ' +
            'They may be from an earlier session, or from another copy of this document opened in this browser. ' +
            'Saving writes them all into this file.'));
        }
        if (rewriteReport.missing > 0) {
          // The strictly worse outcome of the two, and until now the only one with no warning:
          // a conflict means the text was changed over something, a miss means it was not
          // changed at all. The row for it still shows "was X / now Y" under a heading saying
          // nothing is lost, so without this line the reader is told the opposite of the truth.
          body.appendChild(el('div', 'warn',
            plural(rewriteReport.missing, 'text change', 'text changes') +
            ' could not be placed on this page and ' +
            (rewriteReport.missing === 1 ? 'was' : 'were') + ' NOT applied. The wording below is ' +
            'what was asked for, not what the page says.'));
        }
        if (rewriteReport.conflicts.length > 0) {
          // The element was found, but it said neither the original wording nor the new one.
          // The rewrite was applied regardless — it is what the reviewer asked for, and Put
          // text back still restores the original — but overwriting an author's later change
          // without saying so is how a review tool quietly loses someone's work.
          body.appendChild(el('div', 'warn',
            plural(rewriteReport.conflicts.length, 'text change was', 'text changes were') +
            ' applied over wording that had been changed in the file since. Check them, and use ' +
            'Put text back on any that should not have been.'));
        }

        var open = comments.filter(function (c) { return !c.resolved; });
        var done = comments.filter(function (c) { return c.resolved; });

        var head = el('div', 'row');
        head.appendChild(el('span', 'sec', plural(open.length, 'open comment', 'open comments') +
          (done.length ? ' \u00b7 ' + done.length + ' resolved' : '')));
        body.appendChild(head);

        if (!comments.length) {
          body.appendChild(el('div', 'empty', 'No comments yet. Press the + button, then click anything on the page.'));
        }

        groups.forEach(function (g) {
          var title = (labelFor(g.node) || visibleText(g.node).slice(0, 44) || g.node.tagName.toLowerCase());
          var sec = el('div', 'sec', title);
          body.appendChild(sec);
          g.items.forEach(function (c) {
            var row = commentRow(c, fill);
            var jump = el('button', 'b q', 'Show on page');
            jump.type = 'button';
            jump.addEventListener('click', function () {
              try { g.node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
              schedulePins();
            });
            var actions = row.querySelector('.row');
            if (actions) actions.appendChild(jump);
            body.appendChild(row);
          });
        });

        if (orphans.length) {
          body.appendChild(el('div', 'sec', plural(orphans.length, 'orphaned comment', 'orphaned comments')));
          body.appendChild(el('div', 'note',
            'The element these were written on is no longer on the page. They are kept here so nothing is lost.'));
          orphans.forEach(function (c) {
            var row = commentRow(c, fill);
            var q = c.anchor && c.anchor.quote && c.anchor.quote.exact;
            if (q) row.insertBefore(el('div', 'note', 'Was on: \u201c' + q.slice(0, 80) + '\u201d'), row.firstChild);
            body.appendChild(row);
          });
        }

        var tools = el('div', 'row mt');
        var copy = el('button', 'b', 'Copy summary');
        copy.type = 'button';
        copy.addEventListener('click', copySummary);
        var dl = el('button', 'b', 'Download JSON');
        dl.type = 'button';
        dl.addEventListener('click', exportJson);
        var imp = el('button', 'b', 'Import JSON');
        imp.type = 'button';
        imp.addEventListener('click', importJson);
        var toggle = el('button', 'b', ui.pinsHidden ? 'Show pins' : 'Hide pins');
        toggle.type = 'button';
        toggle.addEventListener('click', function () {
          ui.pinsHidden = !ui.pinsHidden; saveUi(); renderPins();
          toggle.textContent = ui.pinsHidden ? 'Show pins' : 'Hide pins';
        });
        tools.appendChild(copy); tools.appendChild(dl); tools.appendChild(imp);
        tools.appendChild(toggle);
        if (WORDS.saveLabel) {
          var save = el('button', 'b pri', WORDS.saveLabel);
          save.type = 'button';
          save.addEventListener('click', function () { saveOrSend(); });
          tools.appendChild(save);
        }
        body.appendChild(tools);
      }

      fill();
      placeCorner(p);
      mountPanel(p);
      panel.isReview = true;
      panel.refresh = fill;
    }

    function copySummary() {
      computeGroups();
      var lines = ['# Feedback on ' + (doc.title || 'this page'), ''];
      function block(c, where) {
        lines.push('- **' + ((c.author && c.author.name) || 'Anonymous') + '**' +
          (where ? ' on _' + where + '_' : '') + (c.resolved ? ' (resolved)' : '') + ': ' + c.text);
      }
      groups.forEach(function (g) {
        var title = labelFor(g.node) || visibleText(g.node).slice(0, 50) || g.node.tagName.toLowerCase();
        g.items.forEach(function (c) { block(c, title); });
      });
      orphans.forEach(function (c) { block(c, 'element no longer on the page'); });
      var text = lines.join('\n');
      var done = function () { toast('Summary copied to the clipboard.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else fallbackCopy(text, done);
    }

    // --- the JSON round-trip --------------------------------------------------
    //
    // Saving into the file is still the primary route and the only one that needs no second
    // step. The JSON exists for the two things a single file cannot do: handing the feedback
    // to something that is not a browser, and collecting several reviewers who were all sent
    // the same file at the same time. Import merges by the same rules as the boot merge, so
    // "several JSONs onto one deck" and "one file passed down a chain" end in the same place.

    var JSON_FORMAT = 'fbw-feedback';

    function feedbackJson() {
      computeGroups();
      // Where each comment currently sits, resolved at export time. The anchor alone is a CSS
      // path; this is what makes the file readable by a human or an agent that will never run
      // the widget. Derived, never authoritative — import ignores it and re-resolves.
      var placeOf = {};
      groups.forEach(function (g) {
        var label = labelFor(g.node) || clip(visibleText(g.node), 80) || g.node.tagName.toLowerCase();
        g.items.forEach(function (c) {
          placeOf[c.id] = { label: label, tag: g.node.tagName.toLowerCase(), onPage: true, foundVia: g.via };
        });
      });
      orphans.forEach(function (c) {
        placeOf[c.id] = {
          label: (c.anchor && c.anchor.quote && clip(c.anchor.quote.exact, 80)) || null,
          tag: (c.anchor && c.anchor.tag) || null,
          onPage: false, foundVia: null
        };
      });
      return {
        format: JSON_FORMAT,
        formatVersion: 1,
        exportedAt: nowISO(),
        // Which widget produced this export, and which produced each entry in it. One file
        // outlives several builds of the tool, so the two are not the same claim.
        tool: toolInfo ? { name: toolInfo.name || 'fbw', version: toolInfo.version || null, build: toolBuild } : null,
        document: { docId: docId, title: doc.title || null, file: currentFileName() },
        comments: comments.map(function (c) {
          var out = {};
          for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k];
          out.on = placeOf[c.id] || null;
          return out;
        }),
        tombstones: tombstones
      };
    }

    function exportJson() {
      try {
        var name = currentFileName().replace(/\.html?$/i, '') + ' - feedback.json';
        download(new Blob([JSON.stringify(feedbackJson(), null, 2)], { type: 'application/json' }), name);
        toast('Downloaded ' + name + '. It carries the comments, the text changes and the build that wrote them.');
      } catch (err) {
        log('could not build the feedback JSON', err);
        toast('Could not build the JSON export.', { bad: true });
      }
    }

    function importJson() {
      var input = doc.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.setAttribute('style', 'position:fixed;top:-2000px;left:0;');
      doc.body.appendChild(input);
      var settled = false;
      function done() { if (!settled) { settled = true; input.remove(); } }
      input.addEventListener('cancel', done);
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        done();
        if (!f) return;
        var reader = new FileReader();
        reader.onerror = function () { toast('Could not read that file.', { bad: true }); };
        reader.onload = function () {
          var data = null;
          try { data = JSON.parse(String(reader.result)); } catch (e) {}
          if (!data || data.format !== JSON_FORMAT || !Array.isArray(data.comments)) {
            toast('That is not a feedback JSON exported from this widget.', { bad: true });
            return;
          }
          var theirs = (data.document && data.document.docId) || null;
          if (theirs && theirs !== docId) {
            // Same rules as everywhere else: say what is true, and let the reviewer decide.
            // Anchors are resolved against THIS page, so importing across documents mostly
            // produces orphans rather than wrong pins — but it is still the wrong deck.
            ask('That feedback was written on a different document.', [
              { label: 'Cancel', quiet: true, fn: function () { toast('Nothing was imported.'); } },
              { label: 'Import anyway', primary: true, fn: function () { takeImport(data); } }
            ], { body: el('div', 'note', 'Anything it cannot find on this page will be listed as orphaned rather than pinned somewhere wrong.') });
            return;
          }
          takeImport(data);
        };
        reader.readAsText(f);
      });
      input.click();
    }

    function takeImport(data) {
      var before = {};
      comments.forEach(function (c) { before[c.id] = c.updatedAt || ''; });
      var m = merge(comments, data.comments, tombstones, Array.isArray(data.tombstones) ? data.tombstones : []);
      comments = m.comments;
      tombstones = m.tombstones;

      var added = 0, updated = 0, builds = {};
      comments.forEach(function (c) {
        if (!Object.prototype.hasOwnProperty.call(before, c.id)) added++;
        else if (before[c.id] !== (c.updatedAt || '')) updated++;
        if (c.toolBuild && c.toolBuild !== toolBuild) builds[c.toolBuild] = 1;
      });

      persist();
      // Imported rewrites have to reach the page, not just the list.
      applyRewrites();
      renderPins();
      if (panel && panel.refresh) panel.refresh();

      var other = Object.keys(builds);
      toast('Imported ' + plural(added, 'new comment', 'new comments') +
        (updated ? ' and ' + plural(updated, 'update', 'updates') : '') +
        (other.length ? '. Some were written by another build of this widget (' + other.join(', ') + ')' : '') +
        '.' + WORDS.thenMany, { ms: 8000 });
    }

    function fallbackCopy(text, done) {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('style', 'position:fixed;top:-2000px;left:0;opacity:0;');
      doc.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) {}
      ta.remove();
      if (ok) done(); else toast('Could not copy automatically.', { bad: true });
    }

    // ===========================================================================
    // 9. Save
    // ===========================================================================
    //
    // Four rungs, best first. The first three all yield the document's ORIGINAL
    // bytes, which is the whole point: the file we hand back has to be the
    // author's document with comments added, not a screenshot of whatever an
    // interactive page happened to be showing. Rung 4 is the only lossy one.

    var handleCache = null;
    var saving = false;

    function idb() {
      return new Promise(function (res, rej) {
        if (!window.indexedDB) return rej(new Error('no indexedDB'));
        var rq = indexedDB.open('fbw', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('handles'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    }
    function idbGet(key) {
      return idb().then(function (db) {
        return new Promise(function (res) {
          var rq = db.transaction('handles', 'readonly').objectStore('handles').get(key);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        });
      }).catch(function () { return null; });
    }
    function idbPut(key, val) {
      return idb().then(function (db) {
        return new Promise(function (res) {
          var rq = db.transaction('handles', 'readwrite').objectStore('handles').put(val, key);
          rq.onsuccess = function () { res(true); };
          rq.onerror = function () { res(false); };
        });
      }).catch(function () { return false; });
    }

    function currentFileName() {
      var last = (location.pathname.split(/[\\/]/).pop() || 'page.html');
      try { last = decodeURIComponent(last); } catch (e) {}
      last = last.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').trim();
      if (!/\.html?$/i.test(last)) last += '.html';
      return last || 'page.html';
    }

    var ASCII = function (s) {
      var a = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
      return a;
    };

    // Searching bytes rather than decoded text. Character offsets and byte
    // offsets diverge the moment the document contains a non-ASCII character,
    // and slicing a Blob at a character offset silently corrupts the output.
    function bytesIndexOf(hay, needle, from) {
      var n = needle.length, limit = hay.length - n;
      outer: for (var i = from || 0; i <= limit; i++) {
        for (var j = 0; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
        return i;
      }
      return -1;
    }
    function bytesLastIndexOf(hay, needle) {
      var n = needle.length;
      outer: for (var i = hay.length - n; i >= 0; i--) {
        for (var j = 0; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
        return i;
      }
      return -1;
    }

    function sourceHasThisDoc(bytes) {
      if (!docId) return true;
      return bytesIndexOf(bytes, ASCII(SENTINEL_ATTR + '="' + docId + '"'), 0) !== -1;
    }

    // Splice the state island inside a Blob without ever materialising the whole
    // document as a string. A 27 MB deck is a real shape here, and a 27 MB JS
    // string is 54 MB of UTF-16 plus a copy.
    function spliceBlob(blob, stateText) {
      var openPat = ASCII(ISLAND_OPEN);
      var closePat = ASCII(CLOSE_SCRIPT);
      var tailStart = Math.max(0, blob.size - TAIL_SCAN);

      return blob.slice(tailStart).arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var at = bytesLastIndexOf(bytes, openPat);
        if (at === -1 && tailStart > 0) {
          return blob.arrayBuffer().then(function (all) {
            return finish(new Uint8Array(all), 0);
          });
        }
        return finish(bytes, tailStart);

        function finish(b, base) {
          var open = bytesLastIndexOf(b, openPat);
          if (open === -1) throw new Error('state island not found in the file');
          var from = open + openPat.length;
          var close = bytesIndexOf(b, closePat, from);
          if (close === -1) throw new Error('state island is not closed');
          return new Blob([
            blob.slice(0, base + from),
            new TextEncoder().encode(stateText),
            blob.slice(base + close)
          ], { type: 'text/html' });
        }
      });
    }

    function verifiedSource(blob) {
      var head = blob.slice(0, Math.min(blob.size, 64 * 1024));
      return head.arrayBuffer().then(function (buf) {
        return sourceHasThisDoc(new Uint8Array(buf)) ? blob : null;
      });
    }

    function fromHandle(handle) {
      if (!handle) return Promise.resolve(null);
      return handle.getFile().then(function (f) {
        return f.size ? verifiedSource(f) : null;
      }).catch(function () { return null; });
    }

    function fromFetch() {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return Promise.resolve(null);
      return fetch(location.href, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) { return b ? verifiedSource(b) : null; })
        .catch(function () { return null; });
    }

    function fromFilePicker() {
      return new Promise(function (res) {
        var input = doc.createElement('input');
        input.type = 'file';
        input.accept = '.html,.htm,text/html';
        input.setAttribute('style', 'position:fixed;top:-2000px;left:0;');
        doc.body.appendChild(input);
        // Resolves either a Blob, or a reason string the caller turns into one message.
        // Reporting the reason rather than a bare null is what lets the caller avoid
        // stacking two toasts on top of each other for a single failed attempt.
        var settled = false;
        function done(v) {
          if (settled) return;
          settled = true;
          input.remove();
          res(v);
        }
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          if (!f) return done('cancelled');
          verifiedSource(f).then(function (ok) {
            done(ok || 'mismatch');
          }, function () { done('cancelled'); });
        });
        // Cancelling an OS file dialog fires no `change`. Without this the promise never
        // settles, `saving` stays true forever and every later save is a silent no-op — on
        // Firefox and Safari over file://, where this rung is the ONLY byte-perfect route.
        // Cancelling a file dialog is an ordinary thing to do.
        input.addEventListener('cancel', function () { done(null); });
        input.click();
      });
    }

    // Last resort. Warn when the page has clearly been rebuilt at runtime,
    // because that is exactly when a DOM snapshot stops being the document.
    function fromDom() {
      var drifted = Math.abs(doc.getElementsByTagName('*').length - bootNodeCount) > bootNodeCount * 0.02;
      hostDiv.remove();
      var dt = '';
      if (doc.doctype) {
        dt = '<!DOCTYPE ' + doc.doctype.name +
          (doc.doctype.publicId ? ' PUBLIC "' + doc.doctype.publicId + '"' : '') +
          (doc.doctype.systemId ? ' "' + doc.doctype.systemId + '"' : '') + '>\n';
      }
      var html = dt + root.outerHTML;
      doc.body.appendChild(hostDiv);
      return { blob: new Blob([html], { type: 'text/html' }), drifted: drifted };
    }

    function getHandle(interactive) {
      if (handleCache) return Promise.resolve(handleCache);
      if (!window.showSaveFilePicker) return Promise.resolve(null);
      return idbGet(docId).then(function (stored) {
        if (!stored) return null;
        if (!stored.queryPermission) return null;
        return stored.queryPermission({ mode: 'readwrite' }).then(function (state) {
          if (state === 'granted') return stored;
          if (!interactive) return null;
          return stored.requestPermission({ mode: 'readwrite' }).then(function (s) {
            return s === 'granted' ? stored : null;
          });
        }).catch(function () { return null; });
      }).then(function (h) {
        if (h) { handleCache = h; return h; }
        if (!interactive) return null;
        return window.showSaveFilePicker({
          suggestedName: currentFileName(),
          types: [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }]
        }).then(function (nh) {
          handleCache = nh;
          idbPut(docId, nh);
          return nh;
        }).catch(function () { return null; });
      }).catch(function () { return null; });
    }

    function download(blob, name) {
      var url = URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.setAttribute('style', 'position:fixed;top:-2000px;left:0;');
      doc.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking synchronously aborts the download in Safari and older Firefox.
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }

    // `isSnapshot` records that this save came from rung 4, where the document
    // was re-serialised from the DOM rather than read byte-for-byte. That
    // changes the bytes (attribute quoting, entity encoding, tag normalisation),
    // so the document hash no longer matches the stored docId. The flag tells
    // the validator that invariant 8 cannot hold for this file, and tells a
    // human the file is a re-rendering rather than the original. A later
    // byte-perfect save clears it again.
    function currentStateText(isSnapshot) {
      var next = {};
      for (var k in fileState) if (Object.prototype.hasOwnProperty.call(fileState, k)) next[k] = fileState[k];
      next.v = STATE_V;
      next.docId = docId;
      next.comments = comments;
      next.tombstones = tombstones;
      if (isSnapshot) next.snapshot = true;
      else delete next.snapshot;
      return encodeIsland(next);
    }

    function doSave() {
      // Never return in silence. A reviewer who pressed Cmd/Ctrl+S and saw nothing happen
      // assumes it worked; that assumption is how unsaved work gets closed. The dialog can
      // also be sitting behind the window or on another monitor, so say where to look.
      if (saving) {
        toast('A save is already in progress. If a file dialog opened, finish or cancel it.');
        return;
      }
      saving = true;
      render();
      runSave().catch(function (err) {
        log('save failed', err);
        toast('Could not save: ' + (err && err.message ? err.message : 'unknown error'), { bad: true, ms: 7000 });
      }).then(function () { saving = false; render(); });
    }

    function runSave() {
      var name = currentFileName();

      return getHandle(true).then(function (handle) {
        return fromHandle(handle).then(function (src) {
          if (src) return { src: src, handle: handle, via: 'disk' };
          return fromFetch().then(function (s2) {
            if (s2) return { src: s2, handle: handle, via: 'fetch' };
            return null;
          });
        });
      }).then(function (got) {
        if (got) return got;
        // Only ask the reviewer to point at their own file once the automatic routes are
        // exhausted, and be honest about what happens next: this rung cannot write to the
        // file, it produces a copy. The dialog used to promise "to write the feedback into
        // this file" and then always download, which is a straightforward false promise.
        return new Promise(function (res) {
          ask('This browser cannot write to the file directly. Point at ' + name +
              ' so your comments can be added to a copy of it.', [
            { label: 'Use a snapshot instead', quiet: true, fn: function () { res(null); } },
            { label: 'Choose the file', primary: true, fn: function () {
              fromFilePicker().then(function (s) {
                if (s === 'mismatch') return res({ cancelled: 'That is a different document. Save cancelled — nothing was written.' });
                if (s === 'cancelled' || !s) return res({ cancelled: 'Save cancelled. Nothing was written.' });
                res({ src: s, handle: null, via: 'pick' });
              });
            } }
          ], {
            // Escape, a veil click, or another dialog displacing this one. The reviewer backed
            // out; they did not ask for a lossy snapshot. Stop here and say so — silence after
            // a save request reads as success, which is how unsaved work gets closed.
            onDismiss: function () { res({ cancelled: 'Save cancelled. Nothing was written.' }); }
          });
        });
      }).then(function (got) {
        if (got && got.cancelled) return got;
        if (got) return got;
        var dom = fromDom();
        if (dom.drifted) {
          toast('Saved from a snapshot of the page as it looks now, because the original file could not be read. Interactive state may be baked in.', { bad: true, ms: 8000 });
        }
        return { src: dom.blob, handle: null, via: 'dom' };
      }).then(function (got) {
        if (got.cancelled) { toast(got.cancelled); return; }
        var stateText = currentStateText(got.via === 'dom');
        return spliceBlob(got.src, stateText).then(function (out) {
          if (got.handle) {
            // The handle's own name, not the one in the address bar. showSaveFilePicker lets
            // the reviewer save anywhere under any name, so `name` regularly refers to a file
            // that was not the one written.
            var wrote = got.handle.name || name;
            return got.handle.createWritable().then(function (w) {
              return w.write(out).then(function () { return w.close(); });
            }).then(function () {
              markSaved();
              toast('Saved ' + plural(comments.length, 'comment', 'comments') + ' into ' + wrote + '.');
            });
          }
          download(out, name);
          markSaved();
          toast('Downloaded ' + name + ' with ' + plural(comments.length, 'comment', 'comments') +
            '. This copy is the up-to-date one; the file you opened is unchanged.', { ms: 7000 });
        });
      });
    }

    // ===========================================================================
    // 9b. Server sync (server mode only)
    // ===========================================================================
    //
    // The server is the database; localStorage is the outbox. Nothing here keeps a queue of
    // operations — a queue can be replayed twice, reordered, or lost half-written. Instead the
    // widget remembers, per comment, the `updatedAt` the server last CONFIRMED. Anything whose
    // current `updatedAt` differs is pending, and pending things are sent again until they are
    // confirmed. The server's upsert is idempotent and keeps the newer `updatedAt`, so sending
    // the same comment twice is harmless and two reviewers editing one comment converge on the
    // same rule the file merge uses: newer wins, tombstones always win.

    var destroyed = false;
    var syncMeta = SERVER ? readSyncMeta(KEY_SYNC) : emptyMeta();
    var syncState = { inflight: null, again: false, timer: null, failures: 0, lastError: null, loaded: false,
      lastPull: 0, otherPending: 0 };

    function emptyMeta() { return { known: {}, knownTombs: {}, rejected: {} }; }

    // `rejected` holds what the server refused for good (400, 409, 413 …), keyed by comment id,
    // with the `updatedAt` that was refused. Sending that exact version again would be refused
    // again, so it is not pending; editing the comment makes a new version, which is tried.
    function readSyncMeta(key) {
      try {
        var m = JSON.parse(lsGet(key) || '{}') || {};
        return {
          known: m.known && typeof m.known === 'object' ? m.known : {},
          knownTombs: m.knownTombs && typeof m.knownTombs === 'object' ? m.knownTombs : {},
          rejected: m.rejected && typeof m.rejected === 'object' ? m.rejected : {}
        };
      } catch (e) { return emptyMeta(); }
    }

    function isRejected(meta, id, version) {
      var r = meta.rejected[id];
      return !!(r && r.at === version);
    }

    function pendingOf(list, tombs, meta) {
      return {
        up: list.filter(function (c) {
          return meta.known[c.id] !== c.updatedAt && !isRejected(meta, c.id, c.updatedAt);
        }),
        del: tombs.filter(function (t) { return !meta.knownTombs[t.id] && !isRejected(meta, t.id, 'deleted'); })
      };
    }

    function pendingCount() {
      if (!SERVER) return 0;
      var p = pendingOf(comments, tombstones, syncMeta);
      return p.up.length + p.del.length;
    }

    // The comments on this page the server will not take as they stand.
    function rejectedHere() {
      if (!SERVER) return [];
      var out = [];
      comments.forEach(function (c) {
        if (isRejected(syncMeta, c.id, c.updatedAt)) out.push(syncMeta.rejected[c.id]);
      });
      tombstones.forEach(function (t) {
        if (!syncMeta.knownTombs[t.id] && isRejected(syncMeta, t.id, 'deleted')) out.push(syncMeta.rejected[t.id]);
      });
      return out;
    }

    // What an error means for retrying. A request that never got an answer, a server error, a
    // timeout or a rate limit may well work later: retry. An answer that says the request itself
    // is wrong (invalid, too big, the id belongs to another page) will say the same thing
    // forever: stop. Not allowed in is neither — nothing this browser does will fix it, but a
    // sign-in or a new key might, so it is not retried on a timer but is tried again whenever
    // the widget syncs anyway (focus, the poll, Send now, setUser).
    function errorKind(err) {
      var s = err && err.status;
      if (!s) return 'retry';
      if (s === 401 || s === 403) return 'auth';
      if (s === 408 || s === 429 || s >= 500) return 'retry';
      return 'final';
    }

    function apiUrl(path) { return String(endpoint).replace(/\/+$/, '') + path; }

    // `headers` may be a function so a page can hand over a token that expires: it is read on
    // every request, never cached.
    function request(method, path, body, keepalive) {
      if (!window.fetch) return Promise.reject(new Error('this browser has no fetch'));
      var headers = { Accept: 'application/json' };
      var extra = options.headers;
      try { if (typeof extra === 'function') extra = extra(); } catch (e) { extra = null; }
      if (extra && typeof extra === 'object') {
        for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) headers[k] = String(extra[k]);
      }
      // The standalone server's WRITE_KEY. A script tag or an injected file cannot pass a
      // headers function, so the key has an option (and an attribute, and an island field) of
      // its own. It is visible to anyone who reads the page, like the endpoint itself.
      if (writeKey && !headers['X-Feedback-Key']) headers['X-Feedback-Key'] = writeKey;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return fetch(apiUrl(path), {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: options.credentials || 'same-origin',
        cache: 'no-store',
        keepalive: !!keepalive
      }).then(function (r) {
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var err = new Error('the server answered ' + r.status + (data && data.error ? ' (' + data.error + ')' : ''));
            err.status = r.status;
            throw err;
          }
          return data;
        });
      });
    }

    // onError hears about each distinct problem once, not once per retry: a reviewer offline
    // for an hour is one problem, not seventy.
    function reportError(err) {
      if (syncState.reported === err.message) return;
      syncState.reported = err.message;
      callback('onError', err);
    }

    function noteSyncError(err) {
      err = err || new Error('unknown error');
      syncState.lastError = err;
      syncState.failures++;
      log('sync failed', err);
      reportError(err);
      // Back off, but never give up on a network that may come back: 5s, 10s, 20s … capped at
      // five minutes. A reviewer on a train should find everything sent when the train comes
      // out of the tunnel. Not for a refusal, which a timer cannot fix (see errorKind).
      if (errorKind(err) === 'retry') {
        var wait = Math.min(300000, 5000 * Math.pow(2, Math.min(6, syncState.failures - 1)));
        scheduleFlush(wait, true);
      }
      render();
      refreshPanel();
    }

    // Comments the server refused for good. Said once, through onError, with the server's
    // reason; they stay in this browser and the review list keeps saying so.
    function reportRejected(list) {
      if (!list.length) return;
      var first = list[0];
      var err = new Error('The server refused ' + plural(list.length, 'change', 'changes') + ': ' + first.error);
      err.status = first.status;
      log(err.message);
      reportError(err);
    }

    function scheduleFlush(ms, isRetry) {
      if (!SERVER || destroyed) return;
      clearTimeout(syncState.timer);
      // A burst of edits (typing, resolve, undo) goes out as one round, not five.
      syncState.timer = setTimeout(function () {
        if (!isRetry) { flush(); return; }
        // A retry pulls when there is nothing to send, or when the first load never landed:
        // without that, a page that booted offline said "Loading…" until the next poll.
        if (!syncState.loaded || (!pendingCount() && !syncState.otherPending)) pull();
        else flushAll();
      }, ms || 250);
    }

    // Sends whatever is pending for one page and records what the server confirmed in `meta`.
    // Each request stands alone: one comment the server refuses must not hold up the rest.
    function sendPending(page, list, tombs, meta) {
      var p = pendingOf(list, tombs, meta);
      var out = { error: null, adopted: [], dead: [], rejected: [] };
      var chain = Promise.resolve();
      // A refusal for good is recorded against the version that was refused; anything else is
      // kept as the error of this round, and the thing stays pending.
      function failed(id, version) {
        return function (err) {
          if (errorKind(err) === 'final') {
            var r = { at: version, status: err.status, error: String(err.message || err).replace(/^the server answered /, '') };
            meta.rejected[id] = r;
            out.rejected.push(r);
          } else {
            out.error = out.error || err;
          }
        };
      }
      p.up.forEach(function (c) {
        var sent = c.updatedAt;
        var payload = JSON.parse(JSON.stringify(c));
        chain = chain.then(function () {
          return request('PUT', '/comments/' + encodeURIComponent(c.id), { page: page, comment: payload })
            .then(function (res) {
              meta.known[c.id] = sent;
              delete meta.rejected[c.id];
              if (res && res.deleted) {
                // Someone deleted it on the server while this browser still had it.
                meta.knownTombs[c.id] = 1;
                out.dead.push({ id: c.id, deletedAt: res.deletedAt || nowISO() });
              } else if (res && res.comment && res.comment.updatedAt && res.comment.updatedAt !== sent) {
                // The server holds a newer edit by somebody else. Take it.
                meta.known[c.id] = res.comment.updatedAt;
                out.adopted.push(res.comment);
              }
            }, failed(c.id, sent));
        });
      });
      p.del.forEach(function (t) {
        chain = chain.then(function () {
          return request('DELETE', '/comments/' + encodeURIComponent(t.id) +
            '?page=' + encodeURIComponent(page) + '&deletedAt=' + encodeURIComponent(t.deletedAt || nowISO()))
            .then(function () { meta.knownTombs[t.id] = 1; delete meta.rejected[t.id]; }, failed(t.id, 'deleted'));
        });
      });
      return chain.then(function () { return out; });
    }

    function refreshPanel() { if (panel && panel.refresh) panel.refresh(); }

    function flush() {
      if (!SERVER || destroyed) return Promise.resolve();
      if (syncState.inflight) { syncState.again = true; return syncState.inflight; }
      if (!pendingCount()) return Promise.resolve();
      clearTimeout(syncState.timer);
      // Captured now: a navigation in the middle of a flush swaps all three, and the answers
      // still belong to the page the comments were written on.
      var page = pageId, meta = syncMeta, key = KEY_SYNC;
      var run = sendPending(page, comments, tombstones, meta).then(function (r) {
        lsSet(key, JSON.stringify(meta));
        if (page === pageId && (r.adopted.length || r.dead.length)) {
          var m = merge(comments, r.adopted, tombstones, r.dead);
          comments = m.comments;
          tombstones = m.tombstones;
          writeBuffer();
          applyRewrites();
          renderPins();
          notifyChange();
        }
        reportRejected(r.rejected);
        if (r.error) noteSyncError(r.error);
        else { syncState.failures = 0; syncState.lastError = null; }
      }).catch(noteSyncError).then(function () {
        syncState.inflight = null;
        // The page this flush was for may be "another page" by now (an in-app navigation).
        countOtherPending();
        render();
        refreshPanel();
        if (syncState.again) { syncState.again = false; if (!syncState.lastError) scheduleFlush(0); }
      });
      syncState.inflight = run;
      render();
      return run;
    }

    // Fetch this page's comments and merge them in. Everything the server sends is by
    // definition confirmed, so it is recorded as known before the merge; anything local that
    // is newer stays pending and goes out in the flush that follows.
    function pull() {
      if (!SERVER || destroyed) return Promise.resolve();
      var page = pageId;
      syncState.lastPull = Date.now();
      return request('GET', '/comments?page=' + encodeURIComponent(page)).then(function (data) {
        if (destroyed || page !== pageId) return;
        data = data || {};
        var theirs = Array.isArray(data.comments) ? data.comments : [];
        var theirTombs = Array.isArray(data.tombstones) ? data.tombstones : [];
        theirs.forEach(function (c) {
          if (c && c.id) syncMeta.known[String(c.id)] = c.updatedAt || c.createdAt;
        });
        theirTombs.forEach(function (t) { if (t && t.id) syncMeta.knownTombs[String(t.id)] = 1; });
        var before = serialiseComments(comments);
        var m = merge(comments, theirs, tombstones, theirTombs);
        comments = m.comments;
        tombstones = m.tombstones;
        lsSet(KEY_SYNC, JSON.stringify(syncMeta));
        writeBuffer();
        syncState.loaded = true;
        syncState.lastError = null;
        syncState.failures = 0;
        if (serialiseComments(comments) !== before) {
          applyRewrites();
          renderPins();
          notifyChange();
          refreshPanel();
        }
        render();
        return flushAll();
      }, function (err) { noteSyncError(err); });
    }

    // This page's outbox, then any left on other pages. Every path that sends — the retry
    // timer, coming back online, Send now, the poll — comes through here, so an outbox left
    // behind by an in-app navigation is not stranded until the next full page load.
    function flushAll() {
      return flush().then(flushOtherPages).then(function () {
        if (!syncState.lastError && !pendingCount() && !syncState.otherPending) syncState.reported = null;
      });
    }

    // An outbox left on another page of the app — the reviewer commented, navigated away,
    // and the network was down — is sent from whichever page they open next, rather than
    // waiting for them to revisit the page it was written on, which they may never do.
    function otherOutboxes() {
      var boxes = [];
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(NS + ':p-') === 0 && k.split(':').length === 2 && k !== KEY) keys.push(k);
        }
      } catch (e) { return boxes; }
      keys.forEach(function (k) {
        var raw = null;
        try { raw = JSON.parse(lsGet(k) || 'null'); } catch (e) {}
        // Only outboxes written for this same server: two apps on one origin may well send
        // their feedback to two different places.
        if (!raw || !raw.page || raw.endpoint !== endpoint) return;
        var meta = readSyncMeta(k + ':sync');
        var list = (Array.isArray(raw.comments) ? raw.comments : []).map(normalise).filter(Boolean);
        var tombs = Array.isArray(raw.tombstones) ? raw.tombstones : [];
        var p = pendingOf(list, tombs, meta);
        boxes.push({ key: k, page: raw.page, list: list, tombs: tombs, meta: meta, pending: p.up.length + p.del.length });
      });
      return boxes;
    }

    // How much is waiting on other pages, so this page does not say "everything is sent"
    // while it is not.
    function countOtherPending() {
      if (!SERVER || destroyed) return 0;
      var n = 0;
      otherOutboxes().forEach(function (b) { n += b.pending; });
      syncState.otherPending = n;
      return n;
    }

    function flushOtherPages() {
      if (!SERVER || destroyed) return Promise.resolve();
      var firstError = null;
      var chain = Promise.resolve();
      otherOutboxes().forEach(function (b) {
        if (!b.pending) return;
        chain = chain.then(function () {
          return sendPending(b.page, b.list, b.tombs, b.meta).then(function (r) {
            lsSet(b.key + ':sync', JSON.stringify(b.meta));
            reportRejected(r.rejected);
            firstError = firstError || r.error;
          });
        });
      });
      return chain.catch(function (err) { firstError = firstError || err; }).then(function () {
        if (destroyed) return;
        countOtherPending();
        if (firstError) noteSyncError(firstError);
        else { render(); refreshPanel(); }
      });
    }

    // Leaving the page. Requests started now survive the unload only with keepalive, and only
    // if they all start now, so this fires them in parallel rather than one after another.
    // Nothing is recorded as confirmed: the next visit sends again whatever did not land, and
    // the server's upsert makes that harmless.
    function flushOnUnload() {
      if (!SERVER || destroyed) return;
      var p = pendingOf(comments, tombstones, syncMeta);
      p.up.slice(0, 8).forEach(function (c) {
        request('PUT', '/comments/' + encodeURIComponent(c.id), { page: pageId, comment: c }, true).catch(function () {});
      });
      p.del.slice(0, 8).forEach(function (t) {
        request('DELETE', '/comments/' + encodeURIComponent(t.id) + '?page=' + encodeURIComponent(pageId) +
          '&deletedAt=' + encodeURIComponent(t.deletedAt || nowISO()), undefined, true).catch(function () {});
      });
    }

    // One sentence on where things stand, for the review list and the rail's tooltip.
    function syncStatus() {
      var n = pendingCount();
      var others = syncState.otherPending;
      var rejected = rejectedHere();
      var err = syncState.lastError;
      var why = err ? err.message : '';
      var auth = err && errorKind(err) === 'auth';
      var later = auth
        ? ' kept in this browser and sent once the server lets this browser in (sign in, or check the key).'
        : ' kept in this browser and retried automatically.';
      if (n && err) {
        return { bad: true, short: plural(n, 'change', 'changes') + ' not sent yet',
          text: plural(n, 'change', 'changes') + ' not sent yet: ' + why + '. ' +
            (n === 1 ? 'It is' : 'They are') + later };
      }
      if (n) return { bad: false, short: 'Sending…', text: 'Sending ' + plural(n, 'change', 'changes') + '…' };
      if (rejected.length) {
        var k = rejected.length;
        return { bad: true, short: plural(k, 'change', 'changes') + ' refused',
          text: 'The server refused ' + plural(k, 'change', 'changes') + ': ' + rejected[0].error + '. ' +
            (k === 1 ? 'It is' : 'They are') + ' kept in this browser only and will not be retried as ' +
            (k === 1 ? 'it stands' : 'they stand') + '; editing a comment tries again.' };
      }
      if (!syncState.loaded && err) {
        return { bad: true, short: auth ? 'Not allowed in' : 'Server unreachable',
          text: 'Could not load comments from the server: ' + why + '. Showing only what this browser has; new comments are' + later +
            (others ? ' ' + plural(others, 'change', 'changes') + ' made on other pages ' + (others === 1 ? 'is' : 'are') + ' waiting too.' : '') };
      }
      if (!syncState.loaded) return { bad: false, short: 'Loading…', text: 'Loading comments from the server…' };
      if (others) {
        return err
          ? { bad: true, short: plural(others, 'change', 'changes') + ' not sent yet',
              text: plural(others, 'change', 'changes') + ' made on other pages not sent yet: ' + why + '. ' +
                (others === 1 ? 'It is' : 'They are') + later }
          : { bad: false, short: 'Sending…', text: 'Sending ' + plural(others, 'change', 'changes') + ' made on other pages…' };
      }
      return { bad: false, short: 'All comments sent',
        text: 'Everything is sent. Comments from other people appear when you come back to this tab.' };
    }

    function syncNow() {
      if (!SERVER) return Promise.resolve();
      syncState.failures = 0;
      return pull().then(function () {
        var st = syncStatus();
        toast(st.bad ? st.text : (pendingCount() || syncState.otherPending ? st.text : 'All comments are sent.'), { bad: st.bad, ms: st.bad ? 7000 : 3400 });
      });
    }

    // The save button and Cmd/Ctrl+S mean "make it safe", whatever safe means here.
    function saveOrSend() {
      if (FILE) doSave();
      else if (SERVER) syncNow();
    }

    function wireSync() {
      if (!SERVER) return;
      on(window, 'online', function () { syncState.failures = 0; if (syncState.loaded) flushAll(); else pull(); });
      on(doc, 'visibilitychange', function () {
        if (doc.visibilityState === 'visible' && Date.now() - syncState.lastPull > 15000) pull();
      });
      // Polling only while someone is looking. Off with pollInterval: 0.
      var every = options.pollInterval == null ? 60 : Number(options.pollInterval);
      if (every > 0) {
        var iv = setInterval(function () {
          if (doc.visibilityState === 'visible' && !syncState.inflight) pull();
        }, Math.max(10, every) * 1000);
        teardown.push(function () { clearInterval(iv); });
      }
      teardown.push(function () { clearTimeout(syncState.timer); });
    }

    // --- single-page apps -------------------------------------------------------
    //
    // A client-side router changes the page without a load, so the widget is told by the
    // history API itself. Every router in common use (React Router, Next.js, Vue Router,
    // SvelteKit, Angular) goes through pushState/replaceState or fires popstate.
    function watchNavigation() {
      if (FILE) return;
      var check = function () {
        setTimeout(guard(function () {
          if (destroyed) return;
          var next = currentPageId();
          if (next !== pageId) switchPage(next);
        }, 'navigation'), 0);
      };
      ['pushState', 'replaceState'].forEach(function (name) {
        var orig = history[name];
        if (typeof orig !== 'function') return;
        var patched = function () {
          var r = orig.apply(this, arguments);
          check();
          return r;
        };
        history[name] = patched;
        // Only undone if nobody wrapped it after us; otherwise we would unwrap them too.
        teardown.push(function () { if (history[name] === patched) history[name] = orig; });
      });
      on(window, 'popstate', check);
      on(window, 'hashchange', check);
    }

    function switchPage(next) {
      stopPick();
      closeModal(true);
      if (panel) dropPanel();
      // Whatever is pending for the page being left goes out with that page's id; flush()
      // captured it. What does not make it is now another page's outbox, which every later
      // flushAll() sends (the retry timer, coming back online, Send now).
      if (SERVER) flush();
      pageId = next;
      docId = 'p-' + quickHash(pageId);
      KEY = NS + ':' + docId;
      KEY_UI = KEY + ':ui';
      KEY_SYNC = KEY + ':sync';
      ui = readUi();
      if (SERVER) {
        syncMeta = readSyncMeta(KEY_SYNC);
        syncState.loaded = false;
        syncState.lastError = null;
      }
      loadState();
      if (SERVER) countOtherPending();
      // Group keys are positional (g0, g1 …), so a pin from the old page would otherwise be
      // reused for whatever happens to be first on the new one.
      Object.keys(pinEls).forEach(function (k) { pinEls[k].remove(); delete pinEls[k]; });
      render();
      callback('onPageChange', pageId);
      whenSettled(function () {
        if (destroyed) return;
        applyRewrites();
        renderPins();
      });
      if (SERVER) pull();
    }

    // ===========================================================================
    // 10. Boot
    // ===========================================================================

    var bootNodeCount = doc.getElementsByTagName('*').length;
    var rail, fabBtn, listBtn, saveBtn, hideBtn;

    function buildChrome() {
      shadow = hostDiv.attachShadow({ mode: 'open' });
      var style = doc.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      ui_ = el('div', 'r');
      shadow.appendChild(ui_);

      theme = detectTheme();
      var d = theme.dark;
      ui_.setAttribute('style',
        '--a:' + theme.accent + ';--on:' + theme.onAccent +
        ';--bg:' + (d ? '#171c22' : '#fff') + ';--fg:' + (d ? '#eef2f6' : '#141922') +
        ';--mut:' + (d ? '#93a1b1' : '#68727f') + ';--line:' + (d ? '#2b333c' : '#e2e6ec') +
        ';--surf:' + (d ? '#1e252c' : '#f7f9fb'));

      rail = el('div', 'rail ' + (cfg.position === 'bottom-left' ? 'bl' : 'br'));

      fabBtn = el('button', 'fab', '+');
      fabBtn.type = 'button';
      // Says where the comment goes, in the one place every reviewer looks before their
      // first click. Unlike a first-run toast it interrupts nobody and is announced to
      // screen readers.
      fabBtn.title = 'Add a comment — ' + WORDS.where;
      fabBtn.setAttribute('aria-label', 'Add a comment — ' + WORDS.where);
      fabBtn.addEventListener('click', function () {
        if (picking) { stopPick(); return; }
        closePanel(true);
        if (!panel) startPick();
      });

      var acts = el('div', 'acts');

      function act(glyph, label, fn) {
        var b = el('button', 'act');
        b.type = 'button';
        b.setAttribute('aria-label', label);
        var g = el('span', 'n', glyph);
        b.appendChild(g);
        b.appendChild(el('span', 'tip', label));
        b.addEventListener('click', fn);
        acts.appendChild(b);
        return b;
      }

      hideBtn = act('\u25cc', 'Hide pins', function () {
        ui.pinsHidden = !ui.pinsHidden; saveUi(); renderPins(); render();
      });
      // No save button in local mode: there is nowhere further for the comments to go, and a
      // button that does nothing teaches people to distrust the ones that do something.
      if (WORDS.saveLabel) {
        saveBtn = act(SERVER ? '\u21c5' : '\u2913', WORDS.saveLabel, function () { saveOrSend(); });
      }
      listBtn = act('0', 'Open the review list', function () { openReview(); });

      // On a touch device the action row is unreachable: it opens on :hover or :focus-within,
      // and neither is something a tap reliably produces. wireTouch() actively invites an
      // iPad reviewer to long-press and comment, and there is then no Cmd+S, no visible Save
      // and no review list — a surface that takes input and offers no way to keep it. Pin the
      // row open instead. `.rail.open .acts` is already in the stylesheet.
      try {
        if (window.matchMedia && matchMedia('(hover: none)').matches) rail.classList.add('open');
      } catch (e) {}

      rail.appendChild(fabBtn);
      rail.appendChild(acts);
      ui_.appendChild(rail);
      doc.body.appendChild(hostDiv);

      avoidCollision();
    }

    // Documents commonly park their own fixed furniture in the bottom corners.
    // Nudge upward rather than sitting on top of somebody's navigation.
    function avoidCollision() {
      try {
        var probeX = cfg.position === 'bottom-left' ? 48 : innerWidth - 48;
        var probeY = innerHeight - 48;
        var hit = doc.elementFromPoint(probeX, probeY);
        if (hit && !isOurs(hit)) {
          var n = hit;
          while (n && n !== doc.body) {
            if (getComputedStyle(n).position === 'fixed') {
              rail.style.bottom = '88px';
              return;
            }
            n = n.parentElement;
          }
        }
      } catch (e) {}
    }

    function render() {
      if (!listBtn) return;
      var n = comments.filter(function (c) { return !c.resolved; }).length;
      listBtn.querySelector('.n').textContent = String(n);
      listBtn.setAttribute('aria-label',
        comments.length ? 'Open the review list, ' + plural(n, 'open comment', 'open comments') : 'Open the review list');
      hideBtn.querySelector('.tip').textContent = ui.pinsHidden ? 'Show pins' : 'Hide pins';
      var dirty = isDirty();
      if (saveBtn) {
        saveBtn.querySelector('.tip').textContent = FILE ? (saving ? 'Saving…' : WORDS.saveLabel) : syncStatus().short;
        var old = saveBtn.querySelector('.dot');
        if (dirty && !old) saveBtn.appendChild(el('div', 'dot'));
        if (!dirty && old) old.remove();
      }
      var fabDot = fabBtn.querySelector('.dot');
      if (dirty && !fabDot) fabBtn.appendChild(el('div', 'dot'));
      if (!dirty && fabDot) fabDot.remove();
      schedulePins();
    }

    function wireGlobals() {
      // Capture-phase scroll on document, not window: pages whose body is
      // overflow:hidden scroll an inner panel instead, and a window listener
      // never fires on them — the pins simply freeze while the content moves.
      on(doc, 'scroll', schedulePins, { capture: true, passive: true });
      on(window, 'resize', schedulePins, { passive: true });
      on(window, 'orientationchange', schedulePins, { passive: true });
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(schedulePins).catch(function () {});

      if (window.ResizeObserver) {
        var ro = new ResizeObserver(schedulePins);
        ro.observe(root);
        if (doc.body) ro.observe(doc.body);
        teardown.push(function () { ro.disconnect(); });
      }

      // Interactive pages rebuild whole regions. Re-resolve after the churn
      // settles rather than on every mutation, and ignore our own subtree so we
      // never trigger ourselves.
      if (window.MutationObserver) {
        var t = null;
        var mo = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            if (!isOurs(records[i].target)) {
              clearTimeout(t);
              t = setTimeout(function () { renderPins(); if (panel && panel.refresh) panel.refresh(); }, 220);
              return;
            }
          }
        });
        mo.observe(doc.body, { childList: true, subtree: true, attributes: false, characterData: false });
        teardown.push(function () { mo.disconnect(); clearTimeout(t); });
      }

      on(window, 'storage', function (e) {
        if (e.key !== KEY) return;
        var buf = readBuffer();
        var m = merge(comments, buf.comments, tombstones, buf.tombstones);
        comments = m.comments; tombstones = m.tombstones;
        syncIsland();
        render();
        if (panel && panel.refresh) panel.refresh();
      });

      on(doc, 'keydown', function (e) {
        var k = (e.key || '').toLowerCase();
        // Only taken over where it means something. In local mode Cmd/Ctrl+S is the browser's
        // own Save Page, and an app may well have bound it to its own save (saveShortcut:false).
        if ((e.metaKey || e.ctrlKey) && k === 's' && (FILE || (SERVER && options.saveShortcut !== false))) {
          e.preventDefault();
          e.stopPropagation();
          saveOrSend();
          return;
        }
        if (k === 'escape' && !picking) {
          if (modal) { closeModal(true); return; }
          if (panel) closePanel(true);
        }
      }, true);

      on(window, 'beforeunload', function (e) {
        if (!isDirty()) return;
        // Server mode does not nag: what is unconfirmed is in localStorage and goes out on
        // the next visit. It does try once more on the way out, and it does warn when
        // localStorage is not working, because then this tab really is the only copy.
        if (SERVER) {
          flushOnUnload();
          if (!storageBroken) return;
        }
        e.preventDefault();
        e.returnValue = '';
      });
    }

    var teardown = [];

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (current === api) current = null;
      listeners.forEach(function (l) {
        try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) {}
      });
      listeners.length = 0;
      teardown.forEach(function (fn) { try { fn(); } catch (e) {} });
      teardown.length = 0;
      stopPick();
      // Dismissal, so anything waiting on the dialog's answer is released rather than left
      // pending forever on a page that no longer has a widget.
      closeModal(true);
      if (panel) { panel.node.remove(); panel = null; }
      Object.keys(pinEls).forEach(function (k) { pinEls[k].remove(); });
      pinEls = {};
      if (posRaf) cancelAnimationFrame(posRaf);
      root.style.removeProperty('cursor');
      hostDiv.remove();
      if (window.__fbw === api) {
        try { delete window.__fbw; } catch (e) { window.__fbw = undefined; }
      }
    }

    // A page that builds itself on load (hydration, a client-side router) has a
    // DOM that is not final when an inline script at the end of body runs.
    // Waiting for a quiet frame means the first anchor resolve sees the real page.
    function whenSettled(fn) {
      var start = Date.now();
      function tick() {
        var n = doc.getElementsByTagName('*').length;
        if (n === bootNodeCount || Date.now() - start > 1200) { bootNodeCount = n; fn(); return; }
        bootNodeCount = n;
        setTimeout(tick, 120);
      }
      setTimeout(tick, 60);
    }

    function boot() {
      if (!doc.body) { on(doc, 'DOMContentLoaded', boot); return; }
      if (destroyed) return;
      loadState();
      buildChrome();
      wireGlobals();
      wireTouch();
      installConsoleCapture();
      watchNavigation();
      wireSync();
      render();
      // pull() ends in flushAll(), which also sends outboxes left on other pages.
      if (SERVER) { countOtherPending(); pull(); }
      whenSettled(function () {
        if (destroyed) return;
        // Before renderPins, always. The page is showing the author's original words at this
        // moment; replaying the rewrites reconstitutes the document the later reviewers were
        // looking at, which is what their anchors were recorded against.
        applyRewrites();
        renderPins();
        // The one thing at boot worth interrupting for. These comments are held only in this
        // browser, they are about to be drawn as pins on a file that does not contain them,
        // and the next save writes them in.
        //
        // It is not a rare state. `docId` is a hash of the document's own text, so every copy
        // of a deck shares one localStorage key — open a returned copy while still holding
        // your own unsaved notes on the same deck and they appear on it. The review list has
        // said so all along, but only to someone who opens the review list; a pin that turns
        // up with no explanation is the whole problem.
        if (bufferAhead > 0) {
          toast(plural(bufferAhead, 'comment', 'comments') + ' held only in this browser ' +
            (bufferAhead === 1 ? 'is' : 'are') + ' shown here but not in the file. Saving writes ' +
            (bufferAhead === 1 ? 'it' : 'them') + ' in.', { ms: 7000 });
        }
      });
    }

    var api = {
      version: VERSION,
      mode: MODE,
      // A getter: in an app it changes with every in-app navigation.
      get docId() { return docId; },
      // Public surface. Everything below the test seams marker is not.
      getPage: function () { return FILE ? docId : pageId; },
      getComments: function () { return JSON.parse(JSON.stringify(comments)); },
      open: function () { if (!destroyed && !picking) { closePanel(true); if (!panel) startPick(); } },
      close: function () { stopPick(); if (panel) closePanel(false); },
      openReview: function () { if (!destroyed && !(panel && panel.isReview)) openReview(); },
      save: function () { saveOrSend(); },
      sync: function () { return SERVER ? pull() : Promise.resolve(); },
      setUser: function (u) {
        setAppUser(u);
        // A sign-in is what a "not allowed" was waiting for.
        if (SERVER && !destroyed && syncState.lastError && errorKind(syncState.lastError) === 'auth') {
          syncState.failures = 0;
          pull();
        }
      },
      exportJson: function () { return feedbackJson(); },
      importJson: function (data) { takeImport(data); },
      status: function () {
        return {
          mode: MODE, page: FILE ? docId : pageId, comments: comments.length,
          pending: pendingCount(), dirty: isDirty(),
          rejected: rejectedHere().length,
          otherPending: SERVER ? syncState.otherPending : 0,
          lastError: syncState.lastError ? syncState.lastError.message : null,
          loaded: SERVER ? syncState.loaded : true
        };
      },
      destroy: destroy,
      // Test seam: the suite needs to place comments without driving the mouse.
      // `rewrite` is the new text for the element, or null for a plain comment.
      _add: function (node, text, who, rewrite) {
        // `who` undefined means "whoever the widget would use", so tests of `user` go through
        // the same path a real comment does; null still means anonymous.
        var c = withContext(normalise({
          id: newId(), createdAt: nowISO(), updatedAt: nowISO(),
          author: who === undefined ? getAuthor() : who, text: text, resolved: false, toolBuild: toolBuild,
          rewrite: rewrite ? { from: node.textContent, to: rewrite, at: nowISO() } : null,
          anchor: describe(node)
        }));
        comments.push(c);
        if (c.rewrite) setText(node, c.rewrite.to);
        persist();
        notifySubmit(c);
        return c.id;
      },
      _json: function () { return feedbackJson(); },
      _import: function (data) { takeImport(data); },
      _revert: function (id) {
        var c = comments.filter(function (x) { return x.id === id; })[0];
        if (c) revertRewrite(c);
      },
      // Opening the composer without the picker, so a test can assert WHICH fields an element
      // is offered — the text-leaf rule is a promise about what a reviewer can destroy.
      _compose: function (node) { openComposer(describe(node), node.getBoundingClientRect(), node); },
      _closePanel: function () { dropPanel(); },
      _state: function () {
        computeGroups();
        return {
          dirty: isDirty(), storageBroken: storageBroken, bufferAhead: bufferAhead,
          toolBuild: toolBuild,
          rewrites: {
            total: comments.filter(function (c) { return !!c.rewrite; }).length,
            applied: rewriteReport.applied,
            missing: rewriteReport.missing,
            conflicts: rewriteReport.conflicts.length
          },
          // `tag` and `text` so a test can assert WHICH element a comment landed on, not just
          // that it landed somewhere. A count cannot tell a correct resolution from a
          // confident wrong one, and that distinction is the whole of §3's badge/orphan rule.
          groups: groups.map(function (g) {
            return {
              via: g.via,
              n: g.items.length,
              tag: g.node.tagName.toLowerCase(),
              text: visibleText(g.node).slice(0, 80)
            };
          }),
          orphans: orphans.length
        };
      }
    };

    window.__fbw = api;
    guard(boot, 'boot')();
    return api;
  }

  // ===========================================================================
  // The global: window.FeedbackKit
  // ===========================================================================

  function call(name) {
    return function () {
      if (!current) return undefined;
      return current[name].apply(current, arguments);
    };
  }

  var FeedbackKit = {
    __core: true,
    version: VERSION,
    init: function (options) {
      if (current) current.destroy();
      current = createWidget(options || {});
      return current;
    },
    destroy: function () { if (current) current.destroy(); },
    instance: function () { return current; },
    open: call('open'),
    close: call('close'),
    openReview: call('openReview'),
    save: call('save'),
    sync: call('sync'),
    setUser: call('setUser'),
    getComments: function () { return current ? current.getComments() : []; },
    status: function () { return current ? current.status() : null; }
  };
  window.FeedbackKit = FeedbackKit;

  // --- starting by itself --------------------------------------------------
  //
  // Two cases start without anyone calling init():
  //   1. A file prepared by bin/add-feedback.mjs. Its island says so.
  //   2. A script tag that asks for it with data-* attributes, e.g.
  //        script src="feedback-kit.js" data-endpoint="/api/feedback"
  //        script src="feedback-kit.js" data-mode="local"
  //      (no closing tags spelled out here: see the source-level invariant, §8)
  // A bundled import (npm, ESM) has no currentScript, so it never starts by itself: the app
  // calls init() when it is ready, which is what a framework needs.
  function fromAttributes(s) {
    var d = s.dataset || {};
    var o = {};
    if (d.mode) o.mode = d.mode;
    if (d.endpoint) o.endpoint = d.endpoint;
    if (d.writeKey) o.writeKey = d.writeKey;
    if (d.showRewrites) o.showRewrites = d.showRewrites;
    if (d.pageId) o.pageId = d.pageId;
    if (d.accent) o.accent = d.accent;
    if (d.position) o.position = d.position;
    if (d.userName) o.user = { name: d.userName, email: d.userEmail || null };
    if (d.captureConsole === 'true' || d.captureConsole === '') o.captureConsole = true;
    if (d.textEdits === 'false') o.textEdits = false;
    if (d.pollInterval) o.pollInterval = Number(d.pollInterval);
    return o;
  }

  var me = document.currentScript;
  if (document.getElementById('fbw-state')) {
    FeedbackKit.init({});
  } else if (me && me.dataset && (me.dataset.mode || me.dataset.endpoint || me.hasAttribute('data-feedback-kit'))) {
    FeedbackKit.init(fromAttributes(me));
  }
})();
