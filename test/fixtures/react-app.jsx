// Built by test/modes.test.mjs with esbuild, React bundled in, to check the React binding in a
// real React app — StrictMode included, because it mounts, unmounts and remounts every effect.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeedbackWidget } from '../../src/react.js';

function App() {
  const [on, setOn] = useState(true);
  const [user, setUser] = useState({ name: 'Ria' });
  const [, force] = useState(0);
  return (
    <div>
      <h1 id="title">React fixture</h1>
      <p id="para">A paragraph rendered by React.</p>
      <span id="who">{user.name}</span>
      <button id="toggle" onClick={() => setOn((v) => !v)}>toggle widget</button>
      <button id="rerender" onClick={() => force((n) => n + 1)}>rerender</button>
      <button id="switch-user" onClick={() => setUser({ name: 'Sam' })}>switch user</button>
      {on && (
        <FeedbackWidget
          endpoint="/api/feedback"
          user={user}
          // A new function every render: must NOT restart the widget.
          onSubmit={(c) => { window.__submitted = (window.__submitted || 0) + 1; window.__lastSubmitted = c; }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
