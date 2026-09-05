import { mount } from 'svelte';
import './ui/styles/app.css';
import App from './ui/App.svelte';
import { unlockAudio, resumeAudio } from './audio/presenters';

/**
 * iOS will not start an AudioContext without a user gesture, and the first gesture is often a DOM
 * button rather than the canvas — so unlock from the document, once, whatever was touched.
 */
function armAudio(): void {
  const go = (): void => {
    unlockAudio();
    document.removeEventListener('pointerdown', go, true);
    document.removeEventListener('keydown', go, true);
  };
  document.addEventListener('pointerdown', go, { capture: true, passive: true });
  document.addEventListener('keydown', go, { capture: true });
  // A standalone PWA suspends its context on app-switch; re-arm so the next touch brings it back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // A standalone PWA suspends its AudioContext on app-switch.
      resumeAudio();
      document.addEventListener('pointerdown', go, { capture: true, passive: true, once: true });
    }
  });
}

armAudio();
mount(App, { target: document.getElementById('app')! });

// The boot placeholder has done its job once Svelte has painted.
requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 500);
});
