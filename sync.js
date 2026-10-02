/* Sincronización con el servidor: los datos de la app viven en el servidor de casa y este
   dispositivo guarda una copia local para abrir al instante y para trabajar sin conexión.

   - Cada cambio se guarda primero en local (como siempre) y se marca «sin enviar»; unos
     instantes después se envía al servidor con el número de versión sobre el que se basa.
   - Si otro dispositivo cambió algo antes, el servidor contesta 409 y se pregunta qué
     versión conservar. Nunca se pisa en silencio. El servidor guarda además las últimas
     400 versiones, así que un error tampoco pierde datos.
   - Las fotos van aparte: se cachean en este dispositivo y se suben/bajan cuando hay red.
   - Si la sesión de Cloudflare Access caducó, la API contesta con una redirección al login:
     se navega a «/», que pasa por el login y vuelve a la app. */
window.SYNC = (() => {
  'use strict';

  const REV = 'gastos.rev';         // versión del servidor sobre la que se basa la copia local
  const DIRTY = 'gastos.dirty';     // '1' = hay cambios locales sin enviar
  const PEND = 'gastos.fotospend';  // fotos creadas sin conexión, pendientes de subir

  let host = null;
  let pushing = false;
  let again = false;
  let timer = null;
  let loginAsked = false;

  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const rev = () => Number(get(REV)) || 0;
  const isDirty = () => get(DIRTY) === '1';

  class AuthError extends Error {}

  async function api(path, opts) {
    let r;
    try {
      r = await fetch('/api' + path, Object.assign({ credentials: 'same-origin', redirect: 'manual' }, opts));
    } catch (_) {
      throw new Error('offline');
    }
    // Access devuelve una redirección al login cuando la sesión caducó (o aún no hay).
    if (r.type === 'opaqueredirect' || r.status === 0 || r.status === 401 || r.status === 403) {
      throw new AuthError('auth');
    }
    return r;
  }

  function askLogin() {
    if (loginAsked) return;
    loginAsked = true;
    location.href = '/';
  }

  /* ---------------- Estado ---------------- */

  async function push() {
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      const body = JSON.stringify({ rev: rev(), datos: host.getState() });
      const r = await api('/estado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status === 409) {
        host.onConflict(await r.json());
      } else if (r.ok) {
        const j = await r.json();
        set(REV, String(j.rev));
        if (!again) set(DIRTY, '0');
        host.synced(true);
      }
    } catch (err) {
      if (err instanceof AuthError) askLogin();
      host.synced(false);               // sin conexión: sigue «sin enviar» y se reintenta
    } finally {
      pushing = false;
      if (again) { again = false; push(); }
    }
  }

  // Lo llama save() de app.js tras cada cambio.
  function changed() {
    set(DIRTY, '1');
    host.synced(false);
    clearTimeout(timer);
    timer = setTimeout(push, 700);
  }

  // Trae la versión del servidor al abrir y al volver a primer plano.
  async function pull() {
    let r;
    try {
      r = await api('/estado');
    } catch (err) {
      if (err instanceof AuthError) askLogin();
      host.synced(false);
      return;
    }
    if (!r.ok) return;
    const j = await r.json();
    await pushPendingPhotos();

    if (j.datos === null) {                       // servidor vacío: este dispositivo manda
      if (host.hasData()) { set(REV, '0'); push(); }
      return;
    }
    if (!isDirty()) {
      if (j.rev !== rev()) { host.replaceState(j.datos); set(REV, String(j.rev)); }
      host.synced(true);
      return;
    }
    if (j.rev === rev()) { push(); return; }      // solo cambié yo
    host.onConflict(j);                           // cambiaron los dos
  }

  // El usuario decide en un conflicto. serverWins=true descarta lo local sin enviar.
  function resolve(serverVersion, serverWins) {
    if (serverWins) {
      host.replaceState(serverVersion.datos);
      set(REV, String(serverVersion.rev));
      set(DIRTY, '0');
      host.synced(true);
    } else {
      set(REV, String(serverVersion.rev));        // conservo lo mío; la versión del servidor queda en su historial
      set(DIRTY, '1');
      push();
    }
  }

  /* ---------------- Fotos ---------------- */

  function pending() { try { return JSON.parse(get(PEND) || '[]'); } catch (_) { return []; } }
  function setPending(list) { set(PEND, JSON.stringify(Array.from(new Set(list)))); }

  async function photoUp(id, blob) {
    const r = await api('/fotos/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!r.ok) throw new Error('http ' + r.status);
  }

  async function pushPendingPhotos() {
    for (const id of pending()) {
      try {
        const blob = await host.photoLocalGet(id);
        if (blob) await photoUp(id, blob);
        setPending(pending().filter((x) => x !== id));
      } catch (_) { return; }
    }
  }

  // Foto desde el servidor (cuando no está en este dispositivo).
  async function photoDown(id) {
    try {
      const r = await api('/fotos/' + encodeURIComponent(id));
      return r.ok ? await r.blob() : null;
    } catch (_) { return null; }
  }

  async function photoPut(id, blob) {
    try {
      await photoUp(id, blob);
    } catch (_) {
      setPending(pending().concat(id));           // se subirá cuando haya red
    }
  }

  async function photoDelete(id) {
    setPending(pending().filter((x) => x !== id));
    try { await api('/fotos/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (_) { /* foto huérfana: inofensiva */ }
  }

  async function photoIds() {
    try {
      const r = await api('/fotos');
      return r.ok ? await r.json() : [];
    } catch (_) { return []; }
  }

  function init(bridge) {
    host = bridge;
    pull();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    window.addEventListener('online', pull);
  }

  return { init, changed, pull, resolve, photoDown, photoPut, photoDelete, photoIds, api, isDirty };
})();
