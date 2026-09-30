import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ShareApp } from './components/ShareApp';
import './styles.css';

// Share links (/s/<token>) get the client view: no sign-in, one shared board.
const shareToken = location.pathname.match(/^\/s\/([\w-]+)/)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareToken ? <ShareApp token={shareToken} /> : <App />}
  </StrictMode>,
);
