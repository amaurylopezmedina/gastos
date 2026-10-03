/* Service worker: app shell en caché para que funcione sin conexión.
   Sube CACHE al publicar cambios y los clientes se actualizarán solos. */
const CACHE = 'gastos-v25';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './i18n.js',
  './statement.js',
  './reconcile.js',
  './loans.js',
  './rubros.js',
  './sync.js',
  './bandeja.js',
  './presupuesto.js',
  './cuentas.js',
  './bolsillo.js?v=25',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* pdf.js (vendor/) pesa 1,5 MB y solo hace falta al importar un estado de
   cuenta: no entra en el shell, se guarda en caché la primera vez que se usa
   y a partir de ahí funciona también sin conexión. */

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' evita que la caché HTTP del navegador devuelva
      // los archivos antiguos al instalar una versión nueva.
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navegaciones: red primero (para recoger versiones nuevas), caché si no hay conexión.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then((res) => {
          // Solo una respuesta válida sustituye a la app guardada: un 404 (o una
          // redirección de login) jamás debe quedar como si fuera la app.
          // El login de Access llega como redirección a otro origen: se enseña tal cual (para
          // poder entrar) pero jamás se guarda como si fuera la app.
          if (res.redirected && new URL(res.url).origin !== self.location.origin) return res;
          if (!res.ok) return caches.match('./index.html').then((hit) => hit || res);
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Resto: caché primero, y refresco en segundo plano.
  ev.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
