import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ShareApp } from './components/ShareApp';
import './styles.css';

// Drags listen for pointerup on window. If the button is released over a video or an embedded
// player (YouTube etc.), the page never hears it and the card stays stuck to the cursor. So: the
// first move without a pressed button after a press ends the drag with a synthetic pointerup.
let pressed = false;
window.addEventListener('pointerdown', () => { pressed = true; }, true);
window.addEventListener('pointerup', () => { pressed = false; }, true);
window.addEventListener('pointermove', (e) => {
  if (pressed && e.buttons === 0 && e.pointerType === 'mouse') {
    pressed = false;
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType }));
  }
}, true);
window.addEventListener('blur', () => {
  if (pressed) { pressed = false; window.dispatchEvent(new PointerEvent('pointerup')); }
});

// Share links (/s/<token>) get the client view: no sign-in, one shared board.
const shareToken = location.pathname.match(/^\/s\/([\w-]+)/)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareToken ? <ShareApp token={shareToken} /> : <App />}
  </StrictMode>,
);
