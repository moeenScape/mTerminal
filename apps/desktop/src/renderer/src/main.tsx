import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/app.css';
import { BUNDLED_TERMINAL_FONT } from './features/workspace/appearance';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');

// xterm measures character cells when a terminal opens, so load the bundled
// terminal font first. Rendering continues with fallbacks if loading fails.
void Promise.all(
  ['400', '700'].map((weight) => document.fonts.load(`${weight} 14px "${BUNDLED_TERMINAL_FONT}"`)),
)
  .catch(() => {})
  .finally(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
