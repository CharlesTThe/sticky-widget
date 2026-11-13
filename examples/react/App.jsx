// React (Vite, Next.js, Create React App …)
//
//   npm install <path-to>/feedback-kit
//
// Render <FeedbackWidget> once, near the root. It draws nothing in your tree; the widget
// lives in its own shadow root on document.body and follows your router by itself.
import { FeedbackWidget } from 'feedback-kit/react';
import { useAuth } from './auth'; // your own

export default function App() {
  const { user, token } = useAuth();

  return (
    <>
      <Routes />
      <FeedbackWidget
        endpoint={import.meta.env.VITE_FEEDBACK_URL}   // e.g. https://feedback.example.com/api/feedback
        user={user ? { name: user.name, email: user.email } : null}
        headers={() => ({ Authorization: `Bearer ${token}` })}
        disabled={import.meta.env.PROD && !user?.isStaff}  // only staff see it in production
        onSubmit={(comment) => console.log('feedback', comment)}
      />
    </>
  );
}

// Next.js App Router: the widget only runs in the browser, so put it in a client component.
//
//   'use client';
//   import { FeedbackWidget } from 'feedback-kit/react';
//   export function Feedback() { return <FeedbackWidget endpoint="/api/feedback" />; }
//
// and render <Feedback /> in app/layout.tsx.
