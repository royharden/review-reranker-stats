import type { CSSProperties } from 'react';

// M1 placeholder. M2 replaces this with the Load + Ranking pages wired to the compute worker.
// System font stack only: no external fonts, no telemetry, no runtime fetches (PLAN §3).
const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif';

const pageStyle: CSSProperties = {
  fontFamily: SYSTEM_FONT_STACK,
  maxWidth: '48rem',
  margin: '0 auto',
  padding: '2rem 1rem',
  lineHeight: 1.5,
};

export function App() {
  return (
    <main style={pageStyle}>
      <h1>Fair Review Re-Ranker</h1>
      <p>
        Construction placeholder. The ranking table, burst queue and evaluation report arrive in later milestones.
        All analysis runs locally in your browser; nothing is uploaded.
      </p>
    </main>
  );
}
