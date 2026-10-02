/* Facturas con IA: manda fotos al servidor de casa, que las lee (OCR + Ollama) y las
   verifica; aquí se revisan y se aplican como gastos.

   - La app sigue guardando todo en el teléfono. El servidor solo guarda las fotos y
     lo que leyó; nunca escribe en los datos de la app.
   - Un gasto de foto lleva id fijo (f_<id>): aplicar dos veces no lo duplica.
   - Lo que viene del servidor es texto no fiable: se pinta con textContent / value,
     jamás con innerHTML.
   - La URL y las credenciales (service token de Cloudflare Access) viven solo en este
     teléfono, en su propia clave de localStorage: no entran en la copia de seguridad. */
window.BANDEJA = (() => {
  'use strict';

  const CFG_KEY = 'gastos.srv';
  const $ = (s) => document.querySelector(s);
  const t = (k, v) => window.I18N.t(k, v);

  let host = null;
  let items = [];
  let current = null;       // factura abierta en el detalle
  let timer = null;
  let photoUrl = null;

  const cfg = () => {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (_) { return {}; }
  };
  const setCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (_) {} };

  function baseUrl() {
    const raw = String(cfg().url || '').trim().replace(/\/+$/, '');
    let u;
    try { u = new URL(raw); } catch (_) { return null; }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;   // nunca el secreto en claro
    return u.origin;
  }

  async function api(path, opts) {
    const c = cfg();
    const base = baseUrl();
    if (!base) throw new Error('config');
    const headers = Object.assign({}, (opts && opts.headers) || {});
    if (c.id && c.secret) {
      headers['CF-Access-Client-Id'] = c.id;
      headers['CF-Access-Client-Secret'] = c.secret;
    }
    const r = await fetch(base + path, Object.assign({}, opts, { headers, credentials: 'omit' }));
    if (!r.ok) throw new Error('http ' + r.status);
    return r;
  }

  /* ---------------- Ajustes ---------------- */

  function paintSettings() {
    const c = cfg();
    $('#bndUrl').value = c.url || '';
    $('#bndId').value = c.id || '';
    $('#bndSecret').value = c.secret || '';
  }

  function saveSettings() {
    setCfg({ url: $('#bndUrl').value.trim(), id: $('#bndId').value.trim(), secret: $('#bndSecret').value.trim() });
  }

  function needConfig() {
    if (baseUrl()) return false;
    host.toast(t('bnd.noconfig'));
    return true;
  }

  async function send(file) {
    if (!file || needConfig()) return;
    host.toast(t('bnd.sending'));
    try {
      const blob = await host.shrink(file, 2000, 0.85);
      const fd = new FormData();
      fd.append('archivo', blob, 'factura.jpg');
      const r = await (await api('/facturas', { method: 'POST', body: fd })).json();
      host.toast(t(r.repetida ? 'bnd.dup' : 'bnd.sent'));
      refresh();
    } catch (err) {
      host.toast(t('bnd.fail'));
    }
  }

  /* ---------------- Lista ---------------- */

  const STATE_ICON = { nueva: '⏳', leyendo: '⏳', listo: '✅', revisar: '⚠️' };

  async function refresh() {
    if (!baseUrl()) { $('#bndCount').textContent = '›'; return; }
    try {
      items = await (await api('/facturas')).json();
    } catch (_) {
      $('#bndCount').textContent = '!';
      if (!$('#bndSheet').hidden) paintList(true);
      return;
    }
    $('#bndCount').textContent = items.length ? String(items.length) : '›';
    if (!$('#bndSheet').hidden && !current) paintList(false);
    const busy = items.some((i) => i.estado === 'nueva' || i.estado === 'leyendo');
    clearTimeout(timer);
    if (busy && !$('#bndSheet').hidden) timer = setTimeout(refresh, 5000);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function paintList(offline) {
    const box = $('#bndList');
    box.replaceChildren();
    if (offline) { box.appendChild(el('p', 'note', t('bnd.offline'))); return; }
    if (!items.length) { box.appendChild(el('p', 'note', t('bnd.empty'))); return; }
    for (const it of items) {
      const c = it.campos || {};
      const row = el('button', 'row action');
      row.type = 'button';
      const left = el('span', null, (STATE_ICON[it.estado] || '') + ' ' + (c.comercio || t('bnd.reading')));
      const right = el('span', 'chev', Number.isFinite(c.total) ? host.fmt(c.total) : '');
      row.append(left, right);
      row.addEventListener('click', () => openDetail(it.id));
      box.appendChild(row);
    }
  }

  /* ---------------- Detalle ---------------- */

  function fillSelect(sel, list, nameFn, withEmpty) {
    sel.replaceChildren();
    if (withEmpty) {
      const o = el('option', null, t('bnd.pick'));
      o.value = '';
      sel.appendChild(o);
    }
    for (const x of list) {
      const o = el('option', null, nameFn(x));
      o.value = x.id;
      sel.appendChild(o);
    }
  }

  async function openDetail(id) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    current = it;
    const c = it.campos || {};
    $('#bndListView').hidden = true;
    $('#bndDetail').hidden = false;
    $('#bndTitle').textContent = t('bnd.detail');
    $('#bndComercio').value = c.comercio || '';
    $('#bndFecha').value = /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '') ? c.fecha : '';
    $('#bndTotal').value = Number.isFinite(c.total) ? (c.total / 100).toFixed(2) : '';
    fillSelect($('#bndCat'), host.cats(), (x) => host.catName(x.id), false);
    if (host.cats().some((x) => x.id === c.categoria)) $('#bndCat').value = c.categoria;
    fillSelect($('#bndPay'), host.pays(), (p) => host.payName(p), true);
    $('#bndCardNote').hidden = true;

    const probs = $('#bndProblems');
    probs.replaceChildren();
    for (const code of it.problemas || []) {
      const k = 'bnd.p.' + code;
      const txt = t(k);
      probs.appendChild(el('li', null, txt === k ? code : txt));
    }
    probs.hidden = !probs.children.length;
    $('#bndInfo').textContent = it.estado === 'nueva' || it.estado === 'leyendo' ? t('bnd.wait') : '';
    $('#bndApply').disabled = it.estado === 'nueva' || it.estado === 'leyendo';

    $('#bndPhoto').hidden = true;
    try {
      const blob = await (await api('/facturas/' + encodeURIComponent(id) + '/foto')).blob();
      if (current !== it) return;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(blob);
      $('#bndPhoto').src = photoUrl;
      $('#bndPhoto').hidden = false;
    } catch (_) { /* sin foto: se puede revisar igual */ }
  }

  function backToList() {
    current = null;
    $('#bndDetail').hidden = true;
    $('#bndListView').hidden = false;
    $('#bndTitle').textContent = t('bnd.open');
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    refresh();
  }

  async function apply() {
    const it = current;
    if (!it) return;
    const comercio = $('#bndComercio').value.trim();
    const fecha = $('#bndFecha').value;
    const cents = host.parseAmount($('#bndTotal').value);
    const cat = $('#bndCat').value;
    const pay = $('#bndPay').value;
    if (!comercio || !fecha || !(cents > 0)) return host.toast(t('bnd.invalid'));
    if (!pay) return host.toast(t('bnd.needpay'));
    $('#bndApply').disabled = true;
    try {
      // 1) el servidor confirma lo que tú escribiste (manda sobre la IA y aprende la categoría)
      await api('/facturas/' + encodeURIComponent(it.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercio, fecha, total: (cents / 100).toFixed(2), categoria: cat, tipo: 'gasto' })
      });
      // 2) gasto local con id fijo (idempotente) y su foto
      const id = 'f_' + it.id;
      if (!host.hasExpense(id)) {
        try {
          const blob = await (await api('/facturas/' + encodeURIComponent(it.id) + '/foto')).blob();
          await host.photoPut('ph_' + id, blob);
        } catch (_) { /* el gasto vale aunque la foto no baje */ }
        host.addExpense({ id, cents, cat, pay, date: fecha, note: comercio.slice(0, 60), photo: 'ph_' + id, src: 'foto', ts: Date.now() });
      }
      // 3) cierra la factura en el servidor
      await api('/facturas/' + encodeURIComponent(it.id) + '/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'aplicada' })
      }).catch(() => {});
      host.toast(t('bnd.applied'));
      backToList();
    } catch (_) {
      host.toast(t('bnd.fail'));
    } finally {
      $('#bndApply').disabled = false;
    }
  }

  async function discard() {
    if (!current || !confirm(t('bnd.askdiscard'))) return;
    try {
      await api('/facturas/' + encodeURIComponent(current.id) + '/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'descartada' })
      });
      backToList();
    } catch (_) { host.toast(t('bnd.fail')); }
  }

  /* ---------------- Hoja ---------------- */

  function openSheet() {
    if (needConfig()) return;
    current = null;
    $('#bndDetail').hidden = true;
    $('#bndListView').hidden = false;
    $('#bndTitle').textContent = t('bnd.open');
    $('#bndBackdrop').hidden = false;
    $('#bndSheet').hidden = false;
    paintList(false);
    refresh();
  }

  function closeSheet() {
    clearTimeout(timer);
    current = null;
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    $('#bndBackdrop').hidden = true;
    $('#bndSheet').hidden = true;
  }

  function init(bridge) {
    host = bridge;
    paintSettings();
    for (const id of ['#bndUrl', '#bndId', '#bndSecret']) $(id).addEventListener('change', () => { saveSettings(); refresh(); });
    $('#bndSend').addEventListener('click', () => { if (!needConfig()) $('#bndFile').click(); });
    $('#bndFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; send(f); });
    $('#bndOpen').addEventListener('click', openSheet);
    $('#bndClose').addEventListener('click', () => (current ? backToList() : closeSheet()));
    $('#bndBackdrop').addEventListener('click', closeSheet);
    $('#bndApply').addEventListener('click', apply);
    $('#bndDiscard').addEventListener('click', discard);
    $('#bndPay').addEventListener('change', () => {
      const p = host.pays().find((x) => x.id === $('#bndPay').value);
      $('#bndCardNote').hidden = !p || p.id === 'efectivo' || p.id === 'transfer';
    });
    refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  return { init, refresh };
})();
