/* Bolsillo: el efectivo que llevas físicamente contigo, para controlarlo y detectar si se pierde dinero.

   Uso típico: sacas RD$10,000 de una cuenta, los vas gastando, y la app te dice cuánto DEBERÍAS llevar.
   Cuando cuentas lo que de verdad llevas, la diferencia (faltante o sobrante) queda registrada.

   Cómo está hecho:
   - El bolsillo es la forma de pago «Efectivo» con un saldo conocido y su momento (`opening`, `openingDate`,
     `openingTs`), igual que una cuenta. Arranca en 0 la primera vez que se abre: el efectivo gastado ANTES de
     existir el bolsillo no cuenta (sigue siendo gasto en el presupuesto, pero no resta del bolsillo).
   - Sube con lo que sacas de una cuenta (transferencia cuenta → bolsillo) y con ingresos en efectivo; baja con
     los gastos pagados en efectivo y con lo que depositas en una cuenta.
   - «Contar efectivo» compara lo que cuentas con lo que debías tener. La diferencia se guarda en `pay.counts`
     (no cambia el presupuesto: es control, no gasto). El primer conteo con el bolsillo vacío es solo el punto de
     partida: no se compara con nada.
   - Retirar y depositar son transferencias: no son gasto ni ingreso (ver `kind:'transfer'` en app.js). */
window.BOLSILLO = (() => {
  'use strict';

  const CASH = 'efectivo';
  const KEEP_COUNTS = 50;
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
  const shortDate = (iso) => iso.slice(8) + '/' + iso.slice(5, 7);

  /* ---------------- Cálculo (sin DOM) ---------------- */

  // Entradas que tocan el efectivo: gastos/ingresos pagados en efectivo y transferencias desde o hacia él.
  function movements(expenses, pay) {
    const since = pay && pay.openingDate;
    const sinceTs = (pay && pay.openingTs) || 0;
    return expenses
      .filter((e) => e.pay === CASH || (e.kind === 'transfer' && e.to === CASH))
      // Solo lo posterior al arranque/conteo: lo anterior no es del bolsillo.
      .filter((e) => !since || e.date > since || (e.date === since && sinceTs && (e.ts || 0) > sinceTs))
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

  // Diferencia de un conteo frente a lo esperado. null = conteo inicial (sin nada con qué comparar).
  function difference(expected, counted, hadCounts) {
    if (!hadCounts && expected === 0) return null;
    return counted - expected;
  }

  /* ---------------- Acciones ---------------- */

  // El bolsillo arranca en 0 la primera vez: lo gastado en efectivo antes no es suyo.
  function ensureStart(pay) {
    if (pay.openingDate) return;
    pay.opening = 0;
    pay.openingDate = todayIso();
    pay.openingTs = Date.now();
    host.save();
  }

  function countCash() {
    const pay = cashPay();
    if (!pay) return;
    const expected = window.CUENTAS.statsOf(pay, host.expenses()).balance;
    const answer = prompt(host.t('pocket.countAmount', { n: host.fmt(expected) }), host.amountText(Math.max(0, expected)));
    if (answer === null) return;
    const counted = host.parseAmount(answer);
    if (!Number.isFinite(counted) || counted < 0) return host.toast(host.t('bud.invalid'));

    const diff = difference(expected, counted, (pay.counts || []).length > 0);
    pay.counts = (pay.counts || []).concat({ ts: Date.now(), date: todayIso(), expected: expected, counted: counted, diff: diff }).slice(-KEEP_COUNTS);
    pay.opening = counted;                   // lo contado es la verdad desde ahora
    pay.openingDate = todayIso();
    pay.openingTs = Date.now();
    host.save();
    host.renderAll();
    host.toast(diff === null ? host.t('pocket.counted')
      : diff === 0 ? host.t('pocket.match')
      : host.t(diff < 0 ? 'pocket.short' : 'pocket.over', { n: host.fmt(Math.abs(diff)) }));
  }

  function withdraw() {                      // de una cuenta al bolsillo
    const acct = firstAccount();
    if (!acct) return host.toast(host.t('pocket.needAccount'));
    host.newEntry({ kind: 'transfer', pay: acct.id, to: CASH });
  }

  function deposit() {                       // del bolsillo a una cuenta
    const acct = firstAccount();
    if (!acct) return host.toast(host.t('pocket.needAccount'));
    host.newEntry({ kind: 'transfer', pay: CASH, to: acct.id });
  }

  /* ---------------- Dibujo ---------------- */

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
    if (incoming) title = '\u{1F3E7} ' + host.t('pocket.in') + ' ← ' + host.payName(e.pay);
    else if (outgoing) title = '\u{1F3E6} ' + host.t('pocket.out') + ' → ' + host.payName(e.to);
    else title = (e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : host.catName(e.cat)) + (e.note ? ' · ' + e.note : '');
    const left = el('span', null, title);
    left.appendChild(el('small', 'pocket-date', '  ' + shortDate(e.date)));
    row.appendChild(left);
    row.appendChild(el('span', 'chev pocket-amt' + (plus ? ' plus' : ''), (plus ? '+' : '−') + host.fmt(e.cents)));
    row.addEventListener('click', () => host.openExpense(e.id));
    return row;
  }

  function renderControl(body, pay) {
    const counts = (pay.counts || []).filter((c) => c.diff !== null && c.diff !== undefined);
    body.appendChild(el('h2', 'section-title', host.t('pocket.control')));
    if (!counts.length) {
      body.appendChild(el('p', 'note', host.t('pocket.controlEmpty')));
      return;
    }
    const lost = counts.reduce((s, c) => s + (c.diff < 0 ? -c.diff : 0), 0);
    const extra = counts.reduce((s, c) => s + (c.diff > 0 ? c.diff : 0), 0);
    const card = el('div', 'bud-card');
    const a = el('div', 'bud-sum');
    a.append(el('span', 'bud-sum-l', host.t('pocket.totalShort')), el('span', 'bud-sum-r' + (lost ? ' pocket-bad' : ''), host.fmt(lost)), el('span', 'bud-sum-b', ''));
    card.appendChild(a);
    if (extra) {
      const b = el('div', 'bud-sum');
      b.append(el('span', 'bud-sum-l', host.t('pocket.totalOver')), el('span', 'bud-sum-r', host.fmt(extra)), el('span', 'bud-sum-b', ''));
      card.appendChild(b);
    }
    body.appendChild(card);

    const list = el('div', 'group');
    for (const c of counts.slice(-5).reverse()) {
      const row = el('div', 'row cov-row');
      const left = el('span', null, shortDate(c.date) + ' · ' + host.t('pocket.countedOf', { a: host.fmt(c.counted), b: host.fmt(c.expected) }));
      row.appendChild(left);
      const label = c.diff === 0 ? host.t('pocket.ok') : (c.diff < 0 ? '−' : '+') + host.fmt(Math.abs(c.diff));
      row.appendChild(el('span', 'chev pocket-amt' + (c.diff < 0 ? ' pocket-bad' : c.diff > 0 ? ' plus' : ''), label));
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  function render() {
    const body = $('#pocketBody');
    if (!body || !host) return;
    body.textContent = '';
    const pay = cashPay();
    if (!pay) { body.appendChild(el('p', 'note', host.t('pocket.noPay'))); return; }
    ensureStart(pay);

    const expenses = host.expenses();
    const stats = window.CUENTAS.statsOf(pay, expenses);

    const card = el('div', 'pocket-card');
    card.appendChild(el('div', 'pocket-label', host.t('pocket.have')));
    card.appendChild(el('div', 'pocket-amount' + (stats.balance < 0 ? ' neg' : ''), host.fmt(stats.balance)));
    const last = (pay.counts || []).length ? pay.counts[pay.counts.length - 1] : null;
    card.appendChild(el('div', 'pocket-sub', last
      ? host.t('pocket.lastCount', { d: shortDate(last.date) })
      : host.t('pocket.sinceStart', { d: shortDate(pay.openingDate) })));
    body.appendChild(card);

    const actions = el('div', 'pocket-actions');
    actions.appendChild(button('\u{1F3E7} ' + host.t('pocket.withdraw'), withdraw, 'primary'));
    actions.appendChild(button('\u{1F4B8} ' + host.t('pocket.spend'), () => host.newEntry({ kind: 'expense', pay: CASH })));
    actions.appendChild(button('\u{1F9EE} ' + host.t('pocket.count'), countCash));
    actions.appendChild(button('↩️ ' + host.t('pocket.deposit'), deposit));
    body.appendChild(actions);

    if (stats.balance < 0) body.appendChild(el('p', 'note pocket-warn', host.t('pocket.negative')));

    renderControl(body, pay);

    const spent = spentIn(expenses, host.monthKey());
    const month = el('div', 'bud-card');
    const line = el('div', 'bud-sum');
    line.append(el('span', 'bud-sum-l', host.t('pocket.spentMonth')), el('span', 'bud-sum-r', host.fmt(spent.cents)), el('span', 'bud-sum-b', host.tn('pocket.moves', spent.n)));
    month.appendChild(line);
    body.appendChild(month);

    body.appendChild(el('h2', 'section-title', host.t('pocket.recent')));
    const list = el('div', 'group');
    const recent = movements(expenses, pay).slice(0, 15);
    if (!recent.length) list.appendChild(el('p', 'note', host.t('pocket.empty')));
    for (const e of recent) list.appendChild(rowOf(e));
    body.appendChild(list);
    body.appendChild(el('p', 'note', host.t('pocket.hint')));
    body.appendChild(el('div', 'bottom-pad'));
  }

  function init(bridge) {
    host = bridge;
  }

  return { init, render, movements, spentIn, difference };
})();
