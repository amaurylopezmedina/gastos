/* Sincronización con el servidor: los datos de la app viven en el servidor de casa y este
   dispositivo guarda una copia local para abrir al instante y para trabajar sin conexión.

   - Cada cambio se guarda primero en local (como siempre) y se marca «sin enviar»; unos
     instantes después se envía al servidor con el número de versión sobre el que se basa.
   - Si otro dispositivo (o el propio servidor) cambió algo antes, el servidor contesta 409 y
     los dos lados se COMBINAN solos (ver merge3): no se pregunta ni se descarta nada. El
     servidor guarda además las últimas 400 versiones, así que un error tampoco pierde datos.
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

  /* ---------------- Combinar sin perder nada ---------------- */

  /* Cuando este dispositivo y el servidor cambiaron cosas distintas a la vez, NO se pregunta ni se descarta nada:
     se combinan entidad por entidad (gasto, cuenta, deuda, forma de pago…) con la última versión sincronizada como
     referencia (la «base»):
       - solo cambió aquí  → se queda lo de aquí;   - solo cambió en el servidor → se queda lo del servidor;
       - cambió en los dos → gana lo de aquí (es lo último que hizo la persona);
       - nuevo en un lado  → se conserva;            - borrado en un lado y sin tocar en el otro → se borra.
     El servidor guarda además las últimas 400 versiones, así que nada se pierde de verdad. */
  const LISTS = ['cats', 'pays', 'expenses', 'debts', 'imports', 'events', 'parties'];

  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  const same = (a, b) => canon(a) === canon(b);

  // Elige entre la versión local (l), la del servidor (s) y la base (b) de UNA entidad. undefined = no existe.
  function pick(b, l, s) {
    if (l !== undefined && s !== undefined) {
      if (same(l, s)) return l;
      if (b === undefined) return s;               // sin referencia: manda el servidor
      if (same(l, b)) return s;                    // solo cambió el servidor
      return l;                                    // cambió aquí (o en los dos): gana lo de aquí
    }
    if (l !== undefined) return b !== undefined && same(l, b) ? undefined : l;   // borrado en el servidor, sin tocar aquí → se borra
    if (s !== undefined) return b !== undefined && same(s, b) ? undefined : s;   // borrado aquí, sin tocar en el servidor → se borra
    return undefined;
  }

  function mergeList(b, l, s) {
    const idx = (arr) => new Map((arr || []).filter((x) => x && x.id !== undefined).map((x) => [x.id, x]));
    const B = idx(b), L = idx(l), S = idx(s);
    const out = [];
    for (const id of S.keys()) { const v = pick(B.get(id), L.get(id), S.get(id)); if (v !== undefined) out.push(v); }
    for (const id of L.keys()) if (!S.has(id)) { const v = pick(B.get(id), L.get(id), undefined); if (v !== undefined) out.push(v); }
    return out;
  }

  function mergeMap(b, l, s) {
    const out = {};
    const keys = new Set([...Object.keys(b || {}), ...Object.keys(l || {}), ...Object.keys(s || {})]);
    for (const k of keys) { const v = pick((b || {})[k], (l || {})[k], (s || {})[k]); if (v !== undefined) out[k] = v; }
    return out;
  }

  function merge3(base, local, server) {
    const B = base || {};
    const out = {};
    const keys = new Set([...Object.keys(B), ...Object.keys(local || {}), ...Object.keys(server || {})]);
    for (const k of keys) {
      if (LISTS.indexOf(k) >= 0) out[k] = mergeList(B[k], (local || {})[k], (server || {})[k]);
      else if (k === 'budgetLines') out[k] = mergeMap(B[k], (local || {})[k], (server || {})[k]);
      else { const v = pick(B[k], (local || {})[k], (server || {})[k]); if (v !== undefined) out[k] = v; }
    }
    out.v = Math.max(Number((local || {}).v) || 0, Number((server || {}).v) || 0, 3);
    return out;
  }

  /* ---------------- Estado ---------------- */

  const BASE = 'gastos.base';        // última versión sincronizada (referencia para combinar)
  const getBase = () => { try { return JSON.parse(get(BASE) || 'null'); } catch (_) { return null; } };
  const setBase = (datos) => set(BASE, typeof datos === 'string' ? datos : JSON.stringify(datos));
  let retries = 0;

  // El servidor tiene una versión que este dispositivo no vio: se combina con lo local y se envía el resultado.
  function mergeFrom(server) {
    const merged = merge3(getBase(), host.getState(), server.datos);
    host.replaceState(merged);                    // pinta lo combinado y lo guarda en local
    set(REV, String(server.rev));
    setBase(server.datos);                        // la nueva referencia es lo que acabamos de ver en el servidor
    const differs = !same(merged, server.datos);
    set(DIRTY, differs ? '1' : '0');
    host.merged(differs);
    if (differs) push(); else host.synced(true);
  }

  async function push() {
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      const datos = JSON.stringify(host.getState());
      const body = '{"rev":' + rev() + ',"datos":' + datos + '}';
      const r = await api('/estado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (r.status === 409) {
        if (retries++ < 4) mergeFrom(await r.json());
      } else if (r.ok) {
        const j = await r.json();
        retries = 0;
        set(REV, String(j.rev));
        setBase(datos);
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

  // Lo llama save() de app.js tras cada cambio. Solo cuenta como «sin enviar» si de verdad difiere de lo sincronizado.
  function changed() {
    const base = getBase();
    if (base && same(base, host.getState())) { set(DIRTY, '0'); host.synced(true); return; }
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
      if (host.hasData()) { set(REV, '0'); push(); } else host.synced(true);
      return;
    }
    if (!isDirty()) {
      if (j.rev !== rev()) { host.replaceState(j.datos); set(REV, String(j.rev)); }
      setBase(j.datos);
      host.synced(true);
      return;
    }
    if (j.rev === rev()) { push(); return; }      // solo cambié yo
    mergeFrom(j);                                 // cambiaron los dos: se combinan, sin preguntar
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

  return { init, changed, pull, photoDown, photoPut, photoDelete, photoIds, api, isDirty, merge3 };
})();
