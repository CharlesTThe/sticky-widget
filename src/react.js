// React binding: <FeedbackWidget endpoint="/api/feedback" user={currentUser} />
//
// Render it once, anywhere in the tree (next to your router is a good place). It draws
// nothing itself — the widget lives in its own shadow root on document.body, out of React's
// way — and it starts and stops the one runtime with the component's lifecycle.
//
// Written without JSX so it needs no build step of its own.
import { useEffect, useRef } from 'react';
import { init, setUser } from './index.js';

// Options that need a fresh widget when they change. Everything else (callbacks, `user`,
// `headers`) is read through a ref, so passing an inline arrow function on every render does
// not tear the widget down and rebuild it each time.
const STRUCTURAL = ['mode', 'endpoint', 'pageId', 'accent', 'position', 'captureConsole',
  'textEdits', 'pollInterval', 'credentials', 'saveShortcut', 'writeKey', 'showRewrites'];

export function FeedbackWidget(props) {
  const latest = useRef(props);
  latest.current = props;

  const key = JSON.stringify(STRUCTURAL.map((k) => (typeof props[k] === 'function' ? 'fn' : props[k])));

  useEffect(() => {
    if (props.disabled) return undefined;
    const p = latest.current;
    const options = {};
    for (const k of STRUCTURAL) if (p[k] !== undefined) options[k] = p[k];
    // pageId as a function is re-read on every navigation; route it through the ref so a
    // new closure on each render is picked up without a restart.
    if (typeof p.pageId === 'function') options.pageId = () => latest.current.pageId();
    options.user = p.user;
    options.headers = () => {
      const h = latest.current.headers;
      return typeof h === 'function' ? h() : h;
    };
    for (const name of ['onSubmit', 'onChange', 'onError', 'onOpen', 'onClose', 'onPageChange']) {
      options[name] = (arg) => {
        const fn = latest.current[name];
        if (typeof fn === 'function') fn(arg);
      };
    }
    const instance = init(options);
    return () => { if (instance) instance.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!props.disabled]);

  // Signing in or out should not restart the widget, only change who comments are from.
  const userKey = props.user ? JSON.stringify([props.user.name, props.user.email]) : '';
  // Not while disabled: there is no widget of ours to tell, and the global may be someone else's.
  useEffect(() => { if (!props.disabled) setUser(props.user || null); }, [userKey, !!props.disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export default FeedbackWidget;
