/* Eventos: agrupar gastos de un viaje, una fiesta, una compra grande… sin sacarlos de tus gastos.

   Un evento es solo una ETIQUETA OPCIONAL del gasto (`expense.event` = id del evento). El gasto sigue contando igual
   en el presupuesto, en los totales del mes y en los saldos de las cuentas: el evento solo permite verlos juntos en
   un reporte. Borrar un evento NO borra sus gastos: solo les quita la etiqueta.

   - state.events: [{ id, name, created }]
   - state.activeEvent: id del «evento actual». Mientras haya uno, todo gasto nuevo (a mano o por foto) sale
     preseleccionado en ese evento; en cada gasto se puede quitar o cambiar. */
window.EVENTOS = (() => {
  'use strict';

  let host = null;
  let view = null;                 // id del evento abierto en el reporte (null = lista)
  const $ = (s) => document.querySelector(s);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------------- Cálculo (sin DOM, para poder probarlo) ---------------- */

  const isSpend = (e) => e.kind !== 'income' && e.kind !== 'transfer';

  function summary(eventId, expenses) {
    const items = expenses.filter((e) => e.event === eventId && isSpend(e));
    const add = (map, key, cents) => map.set(key, (map.get(key) || 0) + cents);
    const byCat = new Map(), byPay = new Map(), byDay = new Map();
    let total = 0, tips = 0;
    for (const e of items) {
      total += e.cents;
      tips += Number.isFinite(e.tip) ? e.tip : 0;
      add(byCat, e.rubro || ('cat:' + (e.cat || '')), e.cents);
      add(byPay, e.pay || '', e.cents);
      add(byDay, e.date, e.cents);
    }
    const dates = items.map((e) => e.date).sort();
    return { items, total, tips, count: items.length, first: dates[0] || null, last: dates[dates.length - 1] || null, byCat, byPay, byDay };
  }

  const sorted = (map) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]);

  /* ---------------- Acciones ---------------- */

  function create() {
    const name = (prompt(host.t('ev.askName'), '') || '').trim().slice(0, 60);
    if (!name) return null;
    const ev = host.addEvent(name);
    host.toast(host.t('ev.created'));
    return ev;
  }

  function rename(ev) {
    const name = (prompt(host.t('ev.askName'), ev.name) || '').trim().slice(0, 60);
    if (!name || name === ev.name) return;
    host.renameEvent(ev.id, name);
  }

  function remove(ev) {
    const n = summary(ev.id, host.expenses()).count;
    if (!confirm(host.t('ev.askDelete', { name: ev.name, n: n }))) return;
    host.removeEvent(ev.id);
    view = null;
    paint();
  }

  function exportCsv(ev) {
    const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const rows = summary(ev.id, host.expenses()).items.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0));
    const lines = [['ev.csv.date', 'ev.csv.cat', 'ev.csv.pay', 'ev.csv.desc', 'ev.csv.tip', 'ev.csv.amount'].map((k) => host.t(k)).join(';')];
    for (const e of rows) {
      lines.push([e.date, esc(e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : host.catName(e.cat)), esc(host.payName(e.pay)),
        esc(e.note || ''), e.tip ? host.amountText(e.tip) : '', host.amountText(e.cents)].join(';'));
    }
    const safe = ev.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'evento';
    host.download('evento-' + safe + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    host.toast(host.t('ev.csvDone'));
  }

  function toggleActive(ev) {
    host.setActive(host.active() === ev.id ? null : ev.id);
    host.toast(host.t(host.active() === ev.id ? 'ev.nowActive' : 'ev.noLongerActive'));
    paint();
  }

  /* ---------------- Dibujo ---------------- */

  function button(text, onClick, cls) {
    const b = el('button', 'pocket-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function range(s) {
    if (!s.first) return host.t('ev.noExpenses');
    const f = (d) => d.slice(8) + '/' + d.slice(5, 7);
    return s.first === s.last ? f(s.first) : f(s.first) + ' → ' + f(s.last);
  }

  function listView(body) {
    body.appendChild(button('➕ ' + host.t('ev.new'), () => { const ev = create(); if (ev) { view = ev.id; paint(); } }, 'primary'));
    const events = host.events();
    if (!events.length) { body.appendChild(el('p', 'note', host.t('ev.empty'))); return; }
    const box = el('div', 'group');
    const all = host.expenses();
    const rows = events.map((ev) => ({ ev, s: summary(ev.id, all) })).sort((a, b) => (b.s.last || b.ev.created || '').localeCompare(a.s.last || a.ev.created || ''));
    for (const { ev, s } of rows) {
      const row = el('button', 'row action');
      row.type = 'button';
      const left = el('span', null, '\u{1F392} ' + ev.name + (host.active() === ev.id ? '  •' : ''));
      left.appendChild(el('small', 'pocket-date', '  ' + host.tn('ev.count', s.count) + ' · ' + range(s)));
      row.appendChild(left);
      row.appendChild(el('span', 'chev', host.fmt(s.total)));
      row.addEventListener('click', () => { view = ev.id; paint(); });
      box.appendChild(row);
    }
    body.appendChild(box);
    body.appendChild(el('p', 'note', host.t('ev.hint')));
  }

  function bars(body, titleKey, entries, label) {
    if (!entries.length) return;
    body.appendChild(el('h2', 'section-title', host.t(titleKey)));
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    const box = el('div', 'group');
    for (const [key, cents] of entries) {
      const row = el('div', 'bud-rubro');
      row.appendChild(el('span', 'bud-r-name', label(key)));
      row.appendChild(el('span', 'bud-r-real', host.fmt(cents)));
      row.appendChild(el('span', 'bud-r-budget', Math.round(cents / total * 100) + '%'));
      const bar = el('div', 'bud-bar');
      const fill = el('div', 'bud-fill');
      fill.style.width = Math.round(cents / total * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      box.appendChild(row);
    }
    body.appendChild(box);
  }

  function reportView(body, ev) {
    const s = summary(ev.id, host.expenses());
    const card = el('div', 'pocket-card');
    card.appendChild(el('div', 'pocket-label', host.t('ev.total')));
    card.appendChild(el('div', 'pocket-amount', host.fmt(s.total)));
    card.appendChild(el('div', 'pocket-sub', host.tn('ev.count', s.count) + ' · ' + range(s) + (s.tips ? ' · ' + host.t('ev.tips', { n: host.fmt(s.tips) }) : '')));
    body.appendChild(card);

    const actions = el('div', 'pocket-actions');
    const isActive = host.active() === ev.id;
    actions.appendChild(button(isActive ? '⏹️ ' + host.t('ev.stop') : '▶️ ' + host.t('ev.use'), () => toggleActive(ev), isActive ? '' : 'primary'));
    actions.appendChild(button('\u{1F4E4} ' + host.t('ev.csv'), () => exportCsv(ev)));
    actions.appendChild(button('✏️ ' + host.t('ev.rename'), () => { rename(ev); paint(); }));
    actions.appendChild(button('\u{1F5D1}️ ' + host.t('ev.delete'), () => remove(ev)));
    body.appendChild(actions);
    body.appendChild(el('p', 'note', host.t('ev.partOfExpenses')));

    bars(body, 'ev.byCat', sorted(s.byCat), (k) => (k.indexOf('cat:') === 0 ? host.catName(k.slice(4)) : window.RUBROS.name(k)));
    bars(body, 'ev.byPay', sorted(s.byPay), (k) => host.payName(k));
    bars(body, 'ev.byDay', Array.from(s.byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])), (d) => host.dayLabel(d));

    body.appendChild(el('h2', 'section-title', host.t('ev.expenses')));
    const list = el('div', 'group');
    if (!s.items.length) list.appendChild(el('p', 'note', host.t('ev.noExpensesHint')));
    for (const e of s.items.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0))) {
      const row = el('button', 'row action');
      row.type = 'button';
      const title = (e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : host.catName(e.cat)) + (e.note ? ' · ' + e.note : '');
      const left = el('span', null, title);
      left.appendChild(el('small', 'pocket-date', '  ' + e.date.slice(8) + '/' + e.date.slice(5, 7)));
      row.appendChild(left);
      row.appendChild(el('span', 'chev', host.fmt(e.cents)));
      row.addEventListener('click', () => host.openExpense(e.id));
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  function paint() {
    const body = $('#evBody');
    if (!body || !host) return;
    body.textContent = '';
    const ev = view ? host.events().find((x) => x.id === view) : null;
    if (view && !ev) view = null;
    $('#evTitle').textContent = ev ? ev.name : host.t('ev.title');
    $('#evBack').hidden = !ev;
    if (ev) reportView(body, ev); else listView(body);
    chips();
  }

  // Los «chips» de las pantallas principales: el evento actual (con su total) o el acceso a la lista.
  function chips() {
    const events = host.events();
    const active = events.find((e) => e.id === host.active());
    for (const c of document.querySelectorAll('.ev-chip')) {
      c.classList.toggle('on', !!active);
      c.textContent = active
        ? '\u{1F392} ' + active.name + ' · ' + host.fmt(summary(active.id, host.expenses()).total)
        : '\u{1F392} ' + (events.length ? host.t('ev.chipList', { n: events.length }) : host.t('ev.chipNone'));
    }
  }

  function open(id) {
    view = id || null;
    $('#evBackdrop').hidden = false;
    $('#evSheet').hidden = false;
    $('#evBody').scrollTop = 0;
    paint();
  }

  function close() {
    view = null;
    $('#evBackdrop').hidden = true;
    $('#evSheet').hidden = true;
  }

  function init(bridge) {
    host = bridge;
    $('#evClose').addEventListener('click', close);
    $('#evBackdrop').addEventListener('click', close);
    $('#evBack').addEventListener('click', () => { view = null; paint(); });
    for (const c of document.querySelectorAll('.ev-chip')) {
      c.addEventListener('click', () => open(host.active() || null));      // con evento actual: directo a su reporte
    }
  }

  return { init, render: () => { if (host) { chips(); if (!$('#evSheet').hidden) paint(); } }, open, close, create, summary };
})();
