/* Por cobrar: gastos que pagas tú (con efectivo, bolsillo o tarjeta) pero que son de una empresa o de otra persona
   y te los van a reembolsar.

   Cómo se modela:
   - Un gasto «por cobrar» lleva `recv` = id de la empresa/persona (state.parties). Es una salida REAL de dinero (baja
     tu bolsillo, tu cuenta o sube la deuda de la tarjeta) pero NO cuenta en tu presupuesto ni en tus gastos
     personales, porque te lo van a devolver.
   - Al cobrar se marcan esos gastos (`recvPaid` = fecha) y, si dices en qué cuenta o bolsillo entró el dinero, se crea
     UN movimiento `kind:'refund'` que devuelve el dinero a ese saldo. Un cobro no es un ingreso: no suma a «Ingresos».
   - Se puede deshacer un cobro: borra ese movimiento y vuelve a dejar los gastos como pendientes. */
window.COBRAR = (() => {
  'use strict';

  let host = null;
  let view = null;                         // id de la empresa/persona abierta (null = lista)
  let picked = new Set();                  // gastos seleccionados para cobrar
  let paying = false;                      // panel «marcar como cobrado» abierto
  const $ = (s) => document.querySelector(s);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const todayIso = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const short = (iso) => iso.slice(8) + '/' + iso.slice(5, 7);

  /* ---------------- Cálculo (sin DOM) ---------------- */

  const isCharge = (e) => e.kind !== 'income' && e.kind !== 'transfer' && e.kind !== 'refund';

  function summary(partyId, expenses) {
    const mine = expenses.filter((e) => e.recv === partyId && isCharge(e));
    const pending = mine.filter((e) => !e.recvPaid);
    const paid = mine.filter((e) => e.recvPaid);
    const sum = (l) => l.reduce((s, e) => s + e.cents, 0);
    // Los cobros se agrupan por el movimiento que los registró (o por la fecha si no se registró entrada de dinero).
    const batches = new Map();
    for (const e of paid) {
      const key = e.recvRefund || ('d:' + e.recvPaid);
      if (!batches.has(key)) batches.set(key, { key, date: e.recvPaid, refund: e.recvRefund || null, items: [] });
      batches.get(key).items.push(e);
    }
    return { pending, paid, pendingTotal: sum(pending), paidTotal: sum(paid), batches: Array.from(batches.values()).sort((a, b) => b.date.localeCompare(a.date)) };
  }

  function overall(parties, expenses) {
    let pending = 0, count = 0;
    for (const p of parties) { const s = summary(p.id, expenses); pending += s.pendingTotal; count += s.pending.length; }
    return { pending, count };
  }

  /* ---------------- Acciones ---------------- */

  function createParty() {
    const name = (prompt(host.t('recv.askName'), '') || '').trim().slice(0, 40);
    if (!name) return null;
    const dup = host.parties().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (dup) { host.toast(host.t('recv.exists', { name: dup.name })); return dup; }
    const p = host.addParty(name);
    host.toast(host.t('recv.created'));
    return p;
  }

  function csv(party) {
    const s = summary(party.id, host.expenses());
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const events = new Map(host.events().map((e) => [e.id, e.name]));
    const lines = [['recv.csv.date', 'recv.csv.desc', 'recv.csv.cat', 'recv.csv.event', 'recv.csv.pay', 'recv.csv.proof', 'recv.csv.amount'].map((k) => host.t(k)).join(';')];
    const rows = s.pending.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0));
    for (const e of rows) {
      lines.push([e.date, esc(e.note || ''), esc(e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : host.catName(e.cat)),
        esc(events.get(e.event) || ''), esc(host.payName(e.pay)), e.photo ? host.t('recv.yes') : host.t('recv.no'), host.amountText(e.cents)].join(';'));
    }
    lines.push(['', esc(host.t('recv.csv.total')), '', '', '', '', host.amountText(s.pendingTotal)].join(';'));
    const safe = party.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'por-cobrar';
    host.download('por-cobrar-' + safe + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    host.toast(host.t('recv.csvDone'));
  }

  function renameParty(p) {
    const name = (prompt(host.t('recv.askName'), p.name) || '').trim().slice(0, 40);
    if (name && name !== p.name) host.renameParty(p.id, name);
  }

  function removeParty(p) {
    const n = host.expenses().filter((e) => e.recv === p.id).length;
    if (!confirm(host.t('recv.askDelete', { name: p.name, n: n }))) return;
    host.removeParty(p.id);
    view = null;
    picked = new Set();
    paint();
  }

  function collect(p) {
    const ids = Array.from(picked);
    if (!ids.length) return host.toast(host.t('recv.pickSome'));
    const dest = $('#cbDest').value;
    const date = $('#cbDate').value || todayIso();
    host.collect(ids, dest || null, date, p.name);
    host.toast(host.t('recv.collected'));
    picked = new Set();
    paying = false;
    paint();
  }

  /* ---------------- Dibujo ---------------- */

  function button(text, onClick, cls) {
    const b = el('button', 'pocket-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function listView(body) {
    const parties = host.parties();
    const o = overall(parties, host.expenses());
    const card = el('div', 'pocket-card');
    card.appendChild(el('div', 'pocket-label', host.t('recv.pendingAll')));
    card.appendChild(el('div', 'pocket-amount', host.fmt(o.pending)));
    card.appendChild(el('div', 'pocket-sub', host.tn('recv.count', o.count)));
    body.appendChild(card);
    body.appendChild(button('➕ ' + host.t('recv.new'), () => { const p = createParty(); if (p) { view = p.id; picked = new Set(); paint(); } }, 'primary'));
    if (!parties.length) { body.appendChild(el('p', 'note', host.t('recv.empty'))); return; }
    const box = el('div', 'group');
    for (const p of parties) {
      const s = summary(p.id, host.expenses());
      const row = el('button', 'row action');
      row.type = 'button';
      const left = el('span', null, '\u{1F4BC} ' + p.name);
      left.appendChild(el('small', 'pocket-date', '  ' + host.tn('recv.count', s.pending.length) + (s.paidTotal ? ' · ' + host.t('recv.paidShort', { n: host.fmt(s.paidTotal) }) : '')));
      row.appendChild(left);
      row.appendChild(el('span', 'chev' + (s.pendingTotal ? '' : ' cov-none'), host.fmt(s.pendingTotal)));
      row.addEventListener('click', () => { view = p.id; picked = new Set(); paying = false; paint(); });
      box.appendChild(row);
    }
    body.appendChild(box);
    body.appendChild(el('p', 'note', host.t('recv.hint')));
  }

  function partyView(body, p) {
    const s = summary(p.id, host.expenses());
    const card = el('div', 'pocket-card');
    card.appendChild(el('div', 'pocket-label', host.t('recv.pendingOf', { name: p.name })));
    card.appendChild(el('div', 'pocket-amount', host.fmt(s.pendingTotal)));
    card.appendChild(el('div', 'pocket-sub', host.tn('recv.count', s.pending.length) + (s.paidTotal ? ' · ' + host.t('recv.paidShort', { n: host.fmt(s.paidTotal) }) : '')));
    body.appendChild(card);

    const actions = el('div', 'pocket-actions');
    actions.appendChild(button('✅ ' + host.t('recv.markPaid'), () => { if (!picked.size) { for (const e of s.pending) picked.add(e.id); } paying = true; paint(); }, 'primary'));
    actions.appendChild(button('\u{1F4E4} ' + host.t('recv.csv'), () => csv(p)));
    actions.appendChild(button('✏️ ' + host.t('ev.rename'), () => { renameParty(p); paint(); }));
    actions.appendChild(button('\u{1F5D1}️ ' + host.t('ev.delete'), () => removeParty(p)));
    body.appendChild(actions);

    if (paying) {
      const panel = el('div', 'group cb-panel');
      panel.appendChild(el('p', 'note', host.t('recv.payHint', { n: picked.size, total: host.fmt(s.pending.filter((e) => picked.has(e.id)).reduce((t, e) => t + e.cents, 0)) })));
      const dest = el('select', 'rubro-select'); dest.id = 'cbDest';
      const none = el('option', null, host.t('recv.noEntry')); none.value = ''; dest.appendChild(none);
      for (const pay of host.pays().filter((x) => x.kind === 'account' || x.kind === 'pocket' || x.id === 'efectivo')) {
        const o = el('option', null, host.payName(pay.id)); o.value = pay.id; dest.appendChild(o);
      }
      const firstAcct = host.pays().find((x) => x.kind === 'account');
      if (firstAcct) dest.value = firstAcct.id;
      const date = el('input', 'rubro-select'); date.type = 'date'; date.id = 'cbDate'; date.value = todayIso();
      const go = button(host.t('recv.confirmPaid'), () => collect(p), 'primary');
      const cancel = button(host.t('sheet.cancel'), () => { paying = false; paint(); });
      panel.append(el('div', 'picker-label', host.t('recv.whereMoney')), dest, el('div', 'picker-label', host.t('recv.whenCollected')), date, go, cancel);
      body.appendChild(panel);
    }

    body.appendChild(el('h2', 'section-title', host.t('recv.pendingList') + ' (' + s.pending.length + ')'));
    const list = el('div', 'group');
    if (!s.pending.length) list.appendChild(el('p', 'note', host.t('recv.nonePending')));
    const events = new Map(host.events().map((e) => [e.id, e.name]));
    for (const e of s.pending.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0))) {
      const row = el('div', 'row bnd-doc');
      const chk = el('button', 'bnd-doc-act cb-check', picked.has(e.id) ? '☑' : '☐'); chk.type = 'button';
      chk.addEventListener('click', () => { picked.has(e.id) ? picked.delete(e.id) : picked.add(e.id); paint(); });
      const main = el('button', 'bnd-doc-main'); main.type = 'button';
      const title = (e.note || (e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : host.catName(e.cat)));
      main.append(el('span', 'bnd-doc-title', title + (e.photo ? '  \u{1F4CE}' : '')),
        el('small', 'bnd-doc-sub', short(e.date) + ' · ' + host.payName(e.pay) + (e.event && events.get(e.event) ? ' · \u{1F392} ' + events.get(e.event) : '')));
      main.addEventListener('click', () => host.openExpense(e.id));
      row.append(chk, main, el('span', 'bnd-doc-amt', host.fmt(e.cents)));
      list.appendChild(row);
    }
    body.appendChild(list);

    if (s.batches.length) {
      body.appendChild(el('h2', 'section-title', host.t('recv.collectedList')));
      const box = el('div', 'group');
      for (const b of s.batches) {
        const row = el('div', 'row');
        const total = b.items.reduce((t, e) => t + e.cents, 0);
        const left = el('span', null, '✅ ' + host.t('recv.collectedOn', { d: short(b.date) }));
        left.appendChild(el('small', 'pocket-date', '  ' + host.tn('recv.count', b.items.length) + ' · ' + host.fmt(total)));
        row.appendChild(left);
        const undo = el('button', 'bnd-doc-act', '↩'); undo.type = 'button'; undo.title = host.t('recv.undo'); undo.setAttribute('aria-label', host.t('recv.undo'));
        undo.addEventListener('click', () => { if (confirm(host.t('recv.askUndo'))) { host.undoCollect(b.refund, b.items.map((e) => e.id)); paint(); } });
        row.appendChild(undo);
        box.appendChild(row);
      }
      body.appendChild(box);
    }
  }

  function paint() {
    const body = $('#cbBody');
    if (!body || !host) return;
    const scroll = body.scrollTop;
    body.textContent = '';
    const p = view ? host.parties().find((x) => x.id === view) : null;
    if (view && !p) view = null;
    $('#cbTitle').textContent = p ? p.name : host.t('recv.title');
    $('#cbBack').hidden = !p;
    if (p) partyView(body, p); else listView(body);
    body.scrollTop = scroll;
    chips();
  }

  function chips() {
    const parties = host.parties();
    const o = overall(parties, host.expenses());
    for (const c of document.querySelectorAll('.cb-chip')) {
      c.classList.toggle('on', o.pending > 0);
      c.textContent = o.pending > 0
        ? '\u{1F4BC} ' + host.t('recv.chipPending', { n: host.fmt(o.pending) })
        : '\u{1F4BC} ' + (parties.length ? host.t('recv.chipNone') : host.t('recv.chipEmpty'));
    }
  }

  function open(id) {
    view = id || null;
    picked = new Set();
    paying = false;
    $('#cbBackdrop').hidden = false;
    $('#cbSheet').hidden = false;
    $('#cbBody').scrollTop = 0;
    paint();
  }

  function close() {
    view = null;
    paying = false;
    $('#cbBackdrop').hidden = true;
    $('#cbSheet').hidden = true;
  }

  function init(bridge) {
    host = bridge;
    $('#cbClose').addEventListener('click', close);
    $('#cbBackdrop').addEventListener('click', close);
    $('#cbBack').addEventListener('click', () => { view = null; paying = false; picked = new Set(); paint(); });
    for (const c of document.querySelectorAll('.cb-chip')) c.addEventListener('click', () => open(null));
  }

  return { init, render: () => { if (host) { chips(); if (!$('#cbSheet').hidden) paint(); } }, open, close, createParty, summary, overall };
})();
