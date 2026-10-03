/* Facturas con IA: la foto va al servidor de casa, que la lee (OCR + Ollama), comprueba que los
   números cuadren y propone el rubro del presupuesto. Aquí se revisan y se apuntan.

   - Nada se apunta sin que lo confirmes. Lo dudoso queda en la bandeja marcado con el motivo.
   - Un gasto de foto lleva id fijo (f_<id>): apuntar dos veces no lo duplica.
   - Lo que viene del servidor es texto no fiable (sale del OCR): se pinta con textContent /
     value, nunca con innerHTML.
   - La app y la API comparten origen: no hay URL ni credenciales que configurar. El acceso lo
     controla Cloudflare Access (ver sync.js para el caso de sesión caducada). */
window.BANDEJA = (() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  let host = null;
  let items = [];
  let current = null;       // factura abierta en el detalle
  let timer = null;
  let photoUrl = null;

  const t = (k, v) => host.t(k, v);
  const api = (path, opts) => window.SYNC.api(path, opts);
  const enc = encodeURIComponent;
  const json = { 'Content-Type': 'application/json' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------------- Enviar ---------------- */

  async function send(file) {
    if (!file) return;
    host.toast(t('bnd.sending'));
    try {
      const blob = await host.shrink(file, 2000, 0.85);
      const fd = new FormData();
      fd.append('archivo', blob, 'factura.jpg');
      const r = await api('/facturas', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      host.toast(t(j.repetida ? 'bnd.dup' : 'bnd.sent'));
      refresh();
    } catch (_) {
      host.toast(t('bnd.fail'));
    }
  }

  /* ---------------- Lista ---------------- */

  const ICON = { nueva: '⏳', leyendo: '⏳', listo: '✅', revisar: '⚠️', aplicada: '\u{1F4E5}', descartada: '\u{1F5D1}️' };
  const PENDING = ['nueva', 'leyendo', 'listo', 'revisar'];
  const STUCK_S = 300;                              // una lectura que lleva más de 5 min parece atascada

  const isPending = (it) => PENDING.indexOf(it.estado) >= 0;
  const isStuck = (it) => (it.estado === 'nueva' || it.estado === 'leyendo') && (Date.now() / 1000 - it.creada) > STUCK_S;
  // ¿Conviene ofrecer «Reprocesar» en la fila? Lo que falló, lo descartado y lo atascado. Lo cargado nunca.
  const canReprocess = (it) => it.estado === 'revisar' || it.estado === 'descartada' || isStuck(it);

  function when(it) {
    const d = new Date(it.creada * 1000);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  async function refresh() {
    try {
      const r = await api('/facturas?estado=todas');
      if (!r.ok) throw new Error('http');
      items = await r.json();
    } catch (_) {
      return;                                     // sin conexión: se deja lo último que se vio
    }
    const pend = items.filter(isPending);
    const loaded = items.filter((i) => i.estado === 'aplicada').length;
    for (const banner of document.querySelectorAll('.bnd-banner')) {
      banner.hidden = items.length === 0;                   // visible mientras exista algún documento: de ahí se abre la lista
      banner.classList.toggle('done', pend.length === 0);
      banner.textContent = pend.length ? t('bnd.bannerPend', { p: pend.length, l: loaded }) : t('bnd.bannerDone', { l: loaded });
    }
    const count = $('#docsCount');
    if (count) count.textContent = items.length ? String(items.length) : '›';
    if (!$('#bndSheet').hidden && !current) paintList();
    clearTimeout(timer);
    if (items.some((i) => i.estado === 'nueva' || i.estado === 'leyendo')) timer = setTimeout(refresh, 6000);
  }

  function docRow(it) {
    const c = it.campos || {};
    const row = el('div', 'row bnd-doc');
    const main = el('button', 'bnd-doc-main');
    main.type = 'button';
    const title = el('span', 'bnd-doc-title', (ICON[it.estado] || '') + ' ' + (c.comercio || t('bnd.unread')));
    const sub = (isStuck(it) ? t('bnd.stuck') : t('bnd.st.' + it.estado)) + ' · ' + when(it);
    const hint = it.estado === 'revisar' && (it.problemas || [])[0] ? ' · ' + (t('bnd.p.' + it.problemas[0]) === 'bnd.p.' + it.problemas[0] ? it.problemas[0] : t('bnd.p.' + it.problemas[0])) : '';
    main.append(title, el('small', 'bnd-doc-sub', sub + hint));
    main.addEventListener('click', () => openDetail(it.id));
    row.appendChild(main);
    row.appendChild(el('span', 'bnd-doc-amt', Number.isFinite(c.total) ? host.fmt(c.total) : ''));
    if (canReprocess(it)) {
      const act = el('button', 'bnd-doc-act', '↻');
      act.type = 'button';
      act.setAttribute('aria-label', t('bnd.reprocess'));
      act.title = t('bnd.reprocess');
      act.addEventListener('click', () => reprocess(it.id));
      row.appendChild(act);
    }
    return row;
  }

  function importRow(im) {
    const row = el('div', 'row bnd-doc');
    const main = el('div', 'bnd-doc-main');
    main.append(el('span', 'bnd-doc-title', '\u{1F4C4} ' + im.file), el('small', 'bnd-doc-sub', t('bnd.imp.sub', { d: im.when, n: im.count })));
    row.appendChild(main);
    row.appendChild(el('span', 'bnd-doc-amt', host.fmt(im.cents)));
    return row;
  }

  function paintList() {
    const box = $('#bndList');
    box.replaceChildren();
    const imports = (host.imports() || []).slice().reverse();
    if (!items.length && !imports.length) { box.appendChild(el('p', 'note', t('bnd.emptyAll'))); return; }
    const sections = [
      ['bnd.sec.pending', items.filter(isPending)],
      ['bnd.sec.loaded', items.filter((i) => i.estado === 'aplicada')],
      ['bnd.sec.discarded', items.filter((i) => i.estado === 'descartada')]
    ];
    for (const [key, list] of sections) {
      if (!list.length) continue;
      box.appendChild(el('div', 'bnd-sec', t(key) + ' (' + list.length + ')'));
      for (const it of list) box.appendChild(docRow(it));
    }
    if (imports.length) {                                     // estados de cuenta ya cargados (se deshacen en Ajustes)
      box.appendChild(el('div', 'bnd-sec', t('bnd.sec.imports') + ' (' + imports.length + ')'));
      for (const im of imports) box.appendChild(importRow(im));
    }
  }

  async function swap(file) {
    if (!file || !current) return;
    host.toast(t('bnd.swapping'));
    try {
      const blob = await host.shrink(file, 2000, 0.85);
      const fd = new FormData();
      fd.append('archivo', blob, 'factura.jpg');
      const r = await api('/facturas/' + enc(current.id) + '/sustituir', { method: 'POST', body: fd });
      if (r.status === 409) {
        const msg = await r.json().catch(() => ({}));
        return host.toast(t(/leyendo/.test(msg.detail || '') ? 'bnd.swapBusy' : /cargada/.test(msg.detail || '') ? 'bnd.alreadyLoaded' : 'bnd.swapDup'));
      }
      if (!r.ok) throw new Error('http ' + r.status);
      host.toast(t('bnd.swapped'));
      backToList(false);
    } catch (_) { host.toast(t('bnd.fail')); }
  }

  async function reprocess(id) {
    try {
      const r = await api('/facturas/' + enc(id) + '/reprocesar', { method: 'POST' });
      if (r.status === 409) return host.toast(t('bnd.alreadyLoaded'));
      if (!r.ok) throw new Error('http ' + r.status);
      host.toast(t('bnd.reprocessing'));
      if (current) backToList(false);
      refresh();
    } catch (_) { host.toast(t('bnd.fail')); }
  }

  /* ---------------- Detalle ---------------- */

  function fillRubros(sel, selected) {
    sel.replaceChildren();
    const none = el('option', null, t('bnd.pick'));
    none.value = '';
    sel.appendChild(none);
    for (const g of window.RUBROS.groups) {
      if (g.income || g.id === 'deu') continue;   // la IA no clasifica ingresos ni cuotas de deuda
      const og = document.createElement('optgroup');
      og.label = g.icon + ' ' + window.RUBROS.groupName(g.id);
      for (const r of window.RUBROS.ofGroup(g.id)) {
        const o = el('option', null, window.RUBROS.name(r.id));
        o.value = r.id;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.value = selected && window.RUBROS.get(selected) ? selected : '';
  }

  // `card` = últimos 4 dígitos de la tarjeta impresos en el comprobante (si los hay): se propone esa forma de pago,
  // y si aún no existe se ofrece crearla con el mismo nombre que usa la importación de estados.
  function fillPays(sel, card) {
    sel.replaceChildren();
    delete sel.dataset.newName;
    const none = el('option', null, t('bnd.pick'));
    none.value = '';
    sel.appendChild(none);
    let match = null;
    for (const p of host.pays()) {
      const o = el('option', null, host.payName(p));
      o.value = p.id;
      sel.appendChild(o);
      if (card && p.kind !== 'account' && p.kind !== 'pocket' && host.payName(p).indexOf('\u00b7\u00b7\u00b7' + card) >= 0) match = p.id;
    }
    if (card && !match) {
      const name = t('imp.cardName', { n: card });
      const o = el('option', null, '\u2795 ' + name);
      o.value = '__new__';
      sel.appendChild(o);
      sel.dataset.newName = name;
      match = '__new__';
    }
    if (match) sel.value = match;
    cardNote();
  }

  // Evento opcional: por defecto el evento actual (si lo hay).
  function fillEvents(sel) {
    sel.replaceChildren();
    const none = el('option', null, t('ev.none'));
    none.value = '';
    sel.appendChild(none);
    for (const e of host.events()) {
      const o = el('option', null, '\u{1F392} ' + e.name);
      o.value = e.id;
      sel.appendChild(o);
    }
    sel.value = host.events().some((e) => e.id === host.activeEvent()) ? host.activeEvent() : '';
  }

  // «Por cobrar a» (opcional): por defecto la del evento actual, si la tiene.
  function fillParties(sel) {
    sel.replaceChildren();
    const none = el('option', null, t('recv.none'));
    none.value = '';
    sel.appendChild(none);
    for (const p of host.parties()) {
      const o = el('option', null, '\u{1F4BC} ' + p.name);
      o.value = p.id;
      sel.appendChild(o);
    }
    sel.value = host.activeParty() || '';
  }

  function cardNote() {
    const p = host.pays().find((x) => x.id === $('#bndPay').value);
    $('#bndCardNote').hidden = !(($('#bndPay').value === '__new__') || (p && p.id !== 'efectivo' && p.id !== 'transfer' && p.kind !== 'account' && p.kind !== 'pocket'));
  }

  async function openDetail(id) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    current = it;
    const c = it.campos || {};
    const loaded = it.estado === 'aplicada';
    $('#bndListView').hidden = true;
    $('#bndDetail').hidden = false;
    $('#bndTitle').textContent = t(loaded ? 'bnd.detailLoaded' : 'bnd.detail');
    $('#bndFormBox').hidden = loaded;                // lo ya cargado se consulta, no se vuelve a apuntar
    $('#bndActions').hidden = loaded;
    $('#bndLoadedBox').hidden = !loaded;
    $('#bndReprocess').hidden = loaded;
    $('#bndSwapBtn').hidden = loaded;
    $('#bndComercio').value = c.comercio || '';
    $('#bndFecha').value = /^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '') ? c.fecha : '';
    $('#bndTotal').value = Number.isFinite(c.total) ? host.amountText(c.total) : '';
    $('#bndTip').value = '';
    $('#bndDesc').value = '';
    fillRubros($('#bndRubro'), c.rubro);
    fillPays($('#bndPay'), c.tarjeta);
    fillEvents($('#bndEvent'));
    fillParties($('#bndRecv'));

    const probs = $('#bndProblems');
    probs.replaceChildren();
    for (const code of it.problemas || []) {
      const k = 'bnd.p.' + code;
      probs.appendChild(el('li', null, t(k) === k ? code : t(k)));
    }
    probs.hidden = !probs.children.length;
    const busy = it.estado === 'nueva' || it.estado === 'leyendo';
    $('#bndInfo').textContent = loaded ? t('bnd.alreadyLoaded') : busy ? t('bnd.wait') : (c.tarjeta ? t('bnd.card', { n: c.tarjeta }) : '');
    $('#bndApply').disabled = busy;

    $('#bndPhoto').hidden = true;
    try {
      const blob = await (await api('/facturas/' + enc(id) + '/foto')).blob();
      if (current !== it) return;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(blob);
      $('#bndPhoto').src = photoUrl;
      $('#bndPhoto').hidden = false;
    } catch (_) { /* sin foto: se puede revisar igual */ }
  }

  // `done` = se acaba de cargar o descartar algo: si ya no queda nada por revisar, la hoja se cierra sola.
  function backToList(done) {
    current = null;
    $('#bndDetail').hidden = true;
    $('#bndListView').hidden = false;
    $('#bndTitle').textContent = t('docs.title');
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    refresh().then(() => { if (done && !items.some(isPending)) closeSheet(); else paintList(); });
  }

  async function apply() {
    const it = current;
    if (!it) return;
    const comercio = $('#bndComercio').value.trim();
    const fecha = $('#bndFecha').value;
    const cents = host.parseAmount($('#bndTotal').value);          // total de la factura (sin la propina adicional)
    const tip = Math.max(0, host.parseAmount($('#bndTip').value) || 0);
    const rubro = $('#bndRubro').value;
    let pay = $('#bndPay').value;
    if (!comercio || !fecha || !(cents > 0)) return host.toast(t('bnd.invalid'));
    if (!rubro) return host.toast(t('bnd.needrubro'));
    if (!pay) return host.toast(t('bnd.needpay'));
    $('#bndApply').disabled = true;
    try {
      // 1) el servidor confirma lo que escribiste (manda sobre la IA y aprende el rubro de este comercio)
      const put = await api('/facturas/' + enc(it.id), {
        method: 'PUT', headers: json,
        body: JSON.stringify({ comercio, fecha, total: (cents / 100).toFixed(2), rubro, tipo: 'gasto' })
      });
      if (!put.ok) throw new Error('http ' + put.status);
      const confirmed = await put.json();
      // Seguro contra errores de formato: lo que el servidor confirmó debe ser exactamente lo que se va a apuntar.
      if (confirmed.campos.total !== cents) throw new Error('importe distinto');
      // 2) gasto local con id fijo: si algo falla después, repetir no lo duplica
      const id = 'f_' + it.id;
      if (!host.hasExpense(id)) {
        if (pay === '__new__') pay = host.addCard($('#bndPay').dataset.newName);   // la tarjeta del comprobante, aún sin crear
        host.addExpense({
          id, cents: cents + tip, tip: tip || undefined, event: $('#bndEvent').value || undefined, recv: $('#bndRecv').value || undefined, cat: confirmed.campos.categoria || window.RUBROS.catOf(rubro), rubro, pay, date: fecha,
          note: [comercio, $('#bndDesc').value.trim()].filter(Boolean).join(' \u00b7 ').slice(0, 140), photo: 'ph_' + id, src: 'foto', ts: Date.now()
        });
      }
      // 3) cierra la factura en el servidor (que además pasa su foto al almacén de la app)
      const done = await api('/facturas/' + enc(it.id) + '/estado', { method: 'POST', headers: json, body: JSON.stringify({ estado: 'aplicada' }) });
      if (!done.ok) throw new Error('http ' + done.status);
      host.toast(t('bnd.applied'));
      backToList(true);
    } catch (_) {
      host.toast(t('bnd.fail'));
    } finally {
      $('#bndApply').disabled = false;
    }
  }

  async function discard() {
    if (!current || !confirm(t('bnd.askdiscard'))) return;
    try {
      const r = await api('/facturas/' + enc(current.id) + '/estado', { method: 'POST', headers: json, body: JSON.stringify({ estado: 'descartada' }) });
      if (!r.ok) throw new Error('http');
      backToList(true);
    } catch (_) { host.toast(t('bnd.fail')); }
  }

  /* ---------------- Hoja ---------------- */

  function openSheet() {
    current = null;
    $('#bndDetail').hidden = true;
    $('#bndListView').hidden = false;
    $('#bndTitle').textContent = t('docs.title');
    $('#bndBackdrop').hidden = false;
    $('#bndSheet').hidden = false;
    paintList();
    refresh();
  }

  function closeSheet() {
    current = null;
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    $('#bndBackdrop').hidden = true;
    $('#bndSheet').hidden = true;
    refresh();
  }

  function init(bridge) {
    host = bridge;
    for (const banner of document.querySelectorAll('.bnd-banner')) banner.addEventListener('click', openSheet);
    $('#bndClose').addEventListener('click', () => (current ? backToList(false) : closeSheet()));
    $('#bndReprocess').addEventListener('click', () => current && reprocess(current.id));
    $('#bndSwapBtn').addEventListener('click', () => $('#bndSwapFile').click());
    $('#bndSwapFile').addEventListener('change', (ev) => { const f = ev.target.files[0]; ev.target.value = ''; swap(f); });
    $('#bndViewExpense').addEventListener('click', () => { if (current) { host.openExpense('f_' + current.id); } });
    const docs = $('#docsOpen');
    if (docs) docs.addEventListener('click', openSheet);
    $('#bndBackdrop').addEventListener('click', closeSheet);
    $('#bndApply').addEventListener('click', apply);
    $('#bndDiscard').addEventListener('click', discard);
    $('#bndPay').addEventListener('change', cardNote);
    $('#bndEvent').addEventListener('change', () => {
      const ev = host.events().find((e) => e.id === $('#bndEvent').value);
      if (ev && ev.recv && !$('#bndRecv').value) $('#bndRecv').value = ev.recv;
    });
    document.querySelectorAll('.bnd-tip-chips .tip-chip').forEach((b) => b.addEventListener('click', () => {
      const base = host.parseAmount($('#bndTotal').value);
      if (base > 0) $('#bndTip').value = host.amountText(Math.round(base * Number(b.dataset.pct) / 100));
    }));
    refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  return { init, refresh, send };
})();
