/* Bolsillo: el efectivo que llevas encima.

   El bolsillo es la forma de pago «Efectivo» con un saldo conocido y su fecha, igual que una cuenta
   (`opening` y `openingDate` en esa forma de pago). Sube con los ingresos en efectivo y con el dinero que
   sacas de una cuenta; baja con los gastos pagados en efectivo y con lo que devuelves a una cuenta. Los
   movimientos hasta la fecha del conteo ya están dentro del saldo.

   «Meter dinero» y «Devolver a una cuenta» son transferencias entre una cuenta y el bolsillo: no son gasto
   ni ingreso (ver `kind:'transfer'` en app.js), solo mueven saldos. Lo que sí es gasto es lo que pagas
   después con ese efectivo. */
window.BOLSILLO = (() => {
  'use strict';

  const CASH = 'efectivo';
  let host = null;
  const $ = (s) => document.querySelector(s);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const cashPay = () => host.pays().find((p) => p.id === CASH) || null;
  const firstAccount = () => host.pays().find((p) => p.kind === 'account') || null;

  const todayIso = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  /* ---------------- Cálculo (sin DOM) ---------------- */

  // Entradas que tocan el efectivo: gastos/ingresos pagados en efectivo y transferencias desde o hacia él.
  function movements(expenses) {
    return expenses
      .filter((e) => e.pay === CASH || (e.kind === 'transfer' && e.to === CASH))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
  }

  function spentIn(expenses, monthKey) {
    let cents = 0;
    let n = 0;
    for (const e of expenses) {
      if (e.pay !== CASH || e.kind === 'income' || e.kind === 'transfer') continue;
      if (e.date.slice(0, 7) !== monthKey) continue;
      cents += e.cents;
      n++;
    }
    return { cents, n };
  }

  /* ---------------- Dibujo ---------------- */

  function countCash() {
    const pay = cashPay();
    if (!pay) return;
    const stats = window.CUENTAS.statsOf(pay, host.expenses());
    const amount = prompt(host.t('pocket.countAmount'), host.amountText(Math.max(0, stats.balance)));
    if (amount === null) return;
    const cents = host.parseAmount(amount);
    if (!Number.isFinite(cents) || cents < 0) return host.toast(host.t('bud.invalid'));
    pay.opening = cents;
    pay.openingDate = todayIso();           // lo que hay ahora ya incluye todo lo apuntado hasta este momento
    pay.openingTs = Date.now();             // y lo que apuntes hoy después de contar sí cambia el saldo
    host.save();
    host.renderAll();
    host.toast(host.t('pocket.counted'));
  }

  function fund() {                          // de una cuenta al bolsillo
    const acct = firstAccount();
    if (!acct) return host.toast(host.t('pocket.needAccount'));
    host.newEntry({ kind: 'transfer', pay: acct.id, to: CASH });
  }

  function giveBack() {                      // del bolsillo a una cuenta
    const acct = firstAccount();
    if (!acct) return host.toast(host.t('pocket.needAccount'));
    host.newEntry({ kind: 'transfer', pay: CASH, to: acct.id });
  }

  function button(text, onClick, cls) {
    const b = el('button', 'pocket-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function rowOf(e) {
    const row = el('button', 'row action');
    row.type = 'button';
    const incoming = e.kind === 'transfer' && e.to === CASH;
    const outgoing = e.kind === 'transfer' && e.pay === CASH;
    const plus = incoming || e.kind === 'income';
    let title;
    if (incoming) title = '\u{1F501} ' + host.t('pocket.in') + ' ← ' + host.payName(e.pay);
    else if (outgoing) title = '\u{1F501} ' + host.t('pocket.out') + ' → ' + host.payName(e.to);
    else title = (e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : host.catName(e.cat)) + (e.note ? ' · ' + e.note : '');
    const left = el('span', null, title);
    left.appendChild(el('small', 'pocket-date', '  ' + e.date.slice(8) + '/' + e.date.slice(5, 7)));
    row.appendChild(left);
    row.appendChild(el('span', 'chev pocket-amt' + (plus ? ' plus' : ''), (plus ? '+' : '−') + host.fmt(e.cents)));
    row.addEventListener('click', () => host.openExpense(e.id));
    return row;
  }

  function render() {
    const body = $('#pocketBody');
    if (!body || !host) return;
    body.textContent = '';
    const pay = cashPay();
    if (!pay) { body.appendChild(el('p', 'note', host.t('pocket.missing'))); return; }

    const expenses = host.expenses();
    const stats = window.CUENTAS.statsOf(pay, expenses);

    const card = el('div', 'pocket-card');
    card.appendChild(el('div', 'pocket-label', host.t('pocket.have')));
    card.appendChild(el('div', 'pocket-amount' + (stats.balance < 0 ? ' neg' : ''), host.fmt(stats.balance)));
    card.appendChild(el('div', 'pocket-sub', pay.openingDate
      ? host.t('pocket.asOf', { d: pay.openingDate.slice(8) + '/' + pay.openingDate.slice(5, 7) })
      : host.t('pocket.notCounted')));
    body.appendChild(card);

    const actions = el('div', 'pocket-actions');
    actions.appendChild(button('➕ ' + host.t('pocket.fund'), fund, 'primary'));
    actions.appendChild(button('↩️ ' + host.t('pocket.giveBack'), giveBack));
    actions.appendChild(button('\u{1F9EE} ' + host.t('pocket.count'), countCash));
    actions.appendChild(button('\u{1F4B8} ' + host.t('pocket.spend'), () => host.newEntry({ kind: 'expense', pay: CASH })));
    body.appendChild(actions);

    if (stats.balance < 0) body.appendChild(el('p', 'note pocket-warn', host.t('pocket.negative')));

    const key = host.monthKey();
    const spent = spentIn(expenses, key);
    const month = el('div', 'bud-card');
    const line = el('div', 'bud-sum');
    line.appendChild(el('span', 'bud-sum-l', host.t('pocket.spentMonth', { m: host.monthLabel() })));
    line.appendChild(el('span', 'bud-sum-r', host.fmt(spent.cents)));
    line.appendChild(el('span', 'bud-sum-b', host.tn('pocket.moves', spent.n)));
    month.appendChild(line);
    body.appendChild(month);

    body.appendChild(el('h2', 'section-title', host.t('pocket.recent')));
    const list = el('div', 'group');
    const recent = movements(expenses).slice(0, 15);
    if (!recent.length) list.appendChild(el('p', 'note', host.t('pocket.empty')));
    for (const e of recent) list.appendChild(rowOf(e));
    body.appendChild(list);
    body.appendChild(el('p', 'note', host.t('pocket.hint')));
    body.appendChild(el('div', 'bottom-pad'));
  }

  function init(bridge) {
    host = bridge;
  }

  return { init, render, movements, spentIn };
})();
