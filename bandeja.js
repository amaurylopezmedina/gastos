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

  const ICON = { nueva: '⏳', leyendo: '⏳', listo: '✅', revisar: '⚠️' };

  async function refresh() {
    try {
      const r = await api('/facturas');
      if (!r.ok) throw new Error('http');
      items = await r.json();
    } catch (_) {
      return;                                     // sin conexión: se deja lo último que se vio
    }
    for (const banner of document.querySelectorAll('.bnd-banner')) {
      banner.hidden = items.length === 0;
      banner.textContent = items.length ? t('bnd.banner', { n: items.length }) : '';
    }
    if (!$('#bndSheet').hidden && !current) paintList();
    clearTimeout(timer);
    if (items.some((i) => i.estado === 'nueva' || i.estado === 'leyendo')) timer = setTimeout(refresh, 6000);
  }

  function paintList() {
    const box = $('#bndList');
    box.replaceChildren();
    if (!items.length) { box.appendChild(el('p', 'note', t('bnd.empty'))); return; }
    for (const it of items) {
      const c = it.campos || {};
      const row = el('button', 'row action');
      row.type = 'button';
      row.append(
        el('span', null, (ICON[it.estado] || '') + ' ' + (c.comercio || t('bnd.reading'))),
        el('span', 'chev', Number.isFinite(c.total) ? host.fmt(c.total) : '')
      );
      row.addEventListener('click', () => openDetail(it.id));
      box.appendChild(row);
    }
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
      if (card && p.kind !== 'account' && host.payName(p).indexOf('\u00b7\u00b7\u00b7' + card) >= 0) match = p.id;
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

  function cardNote() {
    const p = host.pays().find((x) => x.id === $('#bndPay').value);
    $('#bndCardNote').hidden = !(($('#bndPay').value === '__new__') || (p && p.id !== 'efectivo' && p.id !== 'transfer' && p.kind !== 'account'));
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
    $('#bndTotal').value = Number.isFinite(c.total) ? host.amountText(c.total) : '';
    $('#bndTip').value = '';
    $('#bndDesc').value = '';
    fillRubros($('#bndRubro'), c.rubro);
    fillPays($('#bndPay'), c.tarjeta);

    const probs = $('#bndProblems');
    probs.replaceChildren();
    for (const code of it.problemas || []) {
      const k = 'bnd.p.' + code;
      probs.appendChild(el('li', null, t(k) === k ? code : t(k)));
    }
    probs.hidden = !probs.children.length;
    const busy = it.estado === 'nueva' || it.estado === 'leyendo';
    $('#bndInfo').textContent = busy ? t('bnd.wait') : (c.tarjeta ? t('bnd.card', { n: c.tarjeta }) : '');
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

  function backToList() {
    current = null;
    $('#bndDetail').hidden = true;
    $('#bndListView').hidden = false;
    $('#bndTitle').textContent = t('bnd.open');
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    // Si no queda nada por revisar, la hoja se cierra sola.
    refresh().then(() => { if (!items.length) closeSheet(); else paintList(); });
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
          id, cents: cents + tip, tip: tip || undefined, cat: confirmed.campos.categoria || window.RUBROS.catOf(rubro), rubro, pay, date: fecha,
          note: [comercio, $('#bndDesc').value.trim()].filter(Boolean).join(' \u00b7 ').slice(0, 140), photo: 'ph_' + id, src: 'foto', ts: Date.now()
        });
      }
      // 3) cierra la factura en el servidor (que además pasa su foto al almacén de la app)
      const done = await api('/facturas/' + enc(it.id) + '/estado', { method: 'POST', headers: json, body: JSON.stringify({ estado: 'aplicada' }) });
      if (!done.ok) throw new Error('http ' + done.status);
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
      const r = await api('/facturas/' + enc(current.id) + '/estado', { method: 'POST', headers: json, body: JSON.stringify({ estado: 'descartada' }) });
      if (!r.ok) throw new Error('http');
      backToList();
    } catch (_) { host.toast(t('bnd.fail')); }
  }

  /* ---------------- Hoja ---------------- */

  function openSheet() {
    current = null;
    $('#bndDetail').hidden = true;
    $('#bndListView').hidden = false;
    $('#bndTitle').textContent = t('bnd.open');
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
    $('#bndClose').addEventListener('click', () => (current ? backToList() : closeSheet()));
    $('#bndBackdrop').addEventListener('click', closeSheet);
    $('#bndApply').addEventListener('click', apply);
    $('#bndDiscard').addEventListener('click', discard);
    $('#bndPay').addEventListener('change', cardNote);
    document.querySelectorAll('.bnd-tip-chips .tip-chip').forEach((b) => b.addEventListener('click', () => {
      const base = host.parseAmount($('#bndTotal').value);
      if (base > 0) $('#bndTip').value = host.amountText(Math.round(base * Number(b.dataset.pct) / 100));
    }));
    refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  return { init, refresh, send };
})();
