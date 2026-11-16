// Demo service worker for store screenshots: caches the app shell.
const SHELL = ['/', '/app.css', '/app.js', '/logo.svg', '/api/notes.json'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('acme-notes-shell-v7').then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
