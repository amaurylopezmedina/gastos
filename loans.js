/* Deudas: préstamos y tarjetas.

   Guarda el balance vivo de cada deuda, calcula la cuota por el sistema
   francés (cuota fija, interés sobre el saldo), arma el calendario de los
   próximos pagos y, al registrar uno, crea el gasto y descuenta el capital
   amortizado del balance. */
window.LOANS = (() => {
  'use strict';

  let host = null;
  let editing = null;            // deuda abierta en la hoja

  const $ = (s) => document.querySelector(s);
  const t = (k, v) => window.I18N.t(k, v);
  const tn = (k, n, v) => window.I18N.tn(k, n, v);

  const DAY = 86400000;

  /* ---------------- Cálculo ---------------- */

  // Cuota del sistema francés. Sin interés, es el principal entre las cuotas.
  function payment(principalCents, annualRate, months) {
    if (!months || months <= 0) return 0;
    const i = (annualRate || 0) / 100 / 12;
    if (i === 0) return Math.round(principalCents / months);
    const factor = Math.pow(1 + i, months);
    return Math.round(principalCents * i * factor / (factor - 1));
  }

  // Reparto de la próxima cuota entre intereses y capital.
  function split(debt) {
    const i = (debt.rate || 0) / 100 / 12;
    const interest = Math.round(debt.balance * i);
    const capital = Math.max(0, Math.min(debt.balance, debt.payment - interest));
    return { interest: interest, capital: capital };
  }

  // Cuotas que faltan para saldar el balance con la cuota actual.
  function monthsLeft(debt) {
    const i = (debt.rate || 0) / 100 / 12;
    if (debt.payment <= 0) return null;
    if (i === 0) return Math.ceil(debt.balance / debt.payment);
    // Si la cuota no cubre ni los intereses, la deuda no se amortiza nunca.
    if (debt.payment <= debt.balance * i) return null;
    const n = -Math.log(1 - (debt.balance * i) / debt.payment) / Math.log(1 + i);
    return Math.ceil(n);
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Fecha de la cuota número `offset` contando desde el próximo vencimiento.
  function dueDate(debt, offset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = Math.min(Math.max(debt.dueDay || 1, 1), 31);

    let d = new Date(today.getFullYear(), today.getMonth(), 1);
    // Si el día de este mes ya pasó, el próximo vencimiento es el mes que viene.
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), Math.min(day, lastDay(today.getFullYear(), today.getMonth())));
    if (thisMonth < today) d = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    d = new Date(d.getFullYear(), d.getMonth() + (offset || 0), 1);
    return new Date(d.getFullYear(), d.getMonth(), Math.min(day, lastDay(d.getFullYear(), d.getMonth())));
  }

  const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();

  const monthKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

  const paidThisMonth = (debt) => {
    const now = monthKey(new Date());
    return Array.isArray(debt.paid) && debt.paid.includes(now);
  };

  /* ---------------- Consolidado y calendario ---------------- */

  function totals() {
    const debts = host.debts();
    return {
      balance: debts.reduce((s, d) => s + d.balance, 0),
      monthly: debts.reduce((s, d) => s + (d.balance > 0 ? d.payment : 0), 0),
      count: debts.filter((d) => d.balance > 0).length
    };
  }

  // Próximos pagos de todas las deudas, ordenados por fecha.
  function schedule(monthsAhead) {
    const rows = [];
    for (const debt of host.debts()) {
      if (debt.balance <= 0) continue;
      const left = monthsLeft(debt);
      const n = Math.min(monthsAhead, left === null ? monthsAhead : left);
      for (let k = 0; k < n; k++) {
        const date = dueDate(debt, k);
        if (k === 0 && paidThisMonth(debt) && monthKey(date) === monthKey(new Date())) continue;
        rows.push({ debt: debt, date: date, cents: debt.payment });
      }
    }
    return rows.sort((a, b) => a.date - b.date);
  }

  /* ---------------- Vista ---------------- */

  function render() {
    if (!host) return;
    const debts = host.debts();
    const sum = totals();

    $('#debtTotal').textContent = host.fmt(sum.balance);
    $('#debtMonthly').textContent = host.fmt(sum.monthly);

    const next = schedule(1)[0];
    $('#debtNext').textContent = next ? host.fmt(next.cents) : '—';
    $('#debtNextWhen').textContent = next ? whenLabel(next.date) : '';

    renderList(debts);
    renderCalendar();
    $('#debtEmpty').hidden = debts.length > 0;
  }

  function whenLabel(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((date - today) / DAY);
    if (days < 0) return t('debt.overdue');
    if (days === 0) return t('debt.today');
    return tn('debt.inDays', days);
  }

  function renderList(debts) {
    const box = $('#debtList');
    box.textContent = '';

    for (const debt of debts) {
      const parts = split(debt);
      const left = monthsLeft(debt);
      const done = debt.principal > 0
        ? Math.max(0, Math.min(100, Math.round((1 - debt.balance / debt.principal) * 100)))
        : 0;
      const paid = paidThisMonth(debt);

      const card = document.createElement('div');
      card.className = 'debt-card' + (debt.balance <= 0 ? ' done' : '');
      card.innerHTML =
        '<div class="debt-head"><span class="debt-ico"></span>' +
        '<button type="button" class="debt-name"></button>' +
        '<span class="debt-balance"></span></div>' +
        '<div class="debt-bar"><i></i></div>' +
        '<div class="debt-facts"></div>' +
        '<div class="debt-actions"></div>';

      card.querySelector('.debt-ico').textContent = debt.kind === 'card' ? '\u{1F4B3}' : '\u{1F3E6}';
      const nameBtn = card.querySelector('.debt-name');
      nameBtn.textContent = debt.name;
      nameBtn.onclick = () => openSheet(debt);
      card.querySelector('.debt-balance').textContent = host.fmt(debt.balance);
      card.querySelector('.debt-bar i').style.width = done + '%';

      const facts = [];
      facts.push(t('debt.fact.payment', { amount: host.fmt(debt.payment) }));
      if (debt.rate) facts.push(t('debt.fact.rate', { rate: String(debt.rate).replace('.', host.decimalSep()) }));
      if (debt.balance > 0) {
        facts.push(left === null ? t('debt.fact.never') : tn('debt.fact.left', left));
        facts.push(t('debt.fact.split', {
          interest: host.fmt(parts.interest), capital: host.fmt(parts.capital)
        }));
      }
      card.querySelector('.debt-facts').textContent = facts.join('  ·  ');

      const actions = card.querySelector('.debt-actions');
      if (debt.balance > 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'debt-pay' + (paid ? ' is-paid' : '');
        btn.textContent = paid ? t('debt.paidThisMonth') : t('debt.register');
        btn.disabled = paid;
        btn.onclick = () => registerPayment(debt);
        actions.appendChild(btn);
      } else {
        const done2 = document.createElement('span');
        done2.className = 'debt-done';
        done2.textContent = t('debt.settled');
        actions.appendChild(done2);
      }

      box.appendChild(card);
    }
  }

  function renderCalendar() {
    const box = $('#debtCalendar');
    box.textContent = '';
    const rows = schedule(6);
    $('#debtCalendarTitle').hidden = rows.length === 0;

    let currentMonth = null;
    for (const row of rows.slice(0, 18)) {
      const key = monthKey(row.date);
      if (key !== currentMonth) {
        currentMonth = key;
        const head = document.createElement('div');
        head.className = 'cal-month';
        const label = host.monthLabel(row.date);
        const monthTotal = rows.filter((r) => monthKey(r.date) === key)
          .reduce((s, r) => s + r.cents, 0);
        head.innerHTML = '<span></span><b></b>';
        head.firstChild.textContent = label;
        head.lastChild.textContent = host.fmt(monthTotal);
        box.appendChild(head);
      }

      const line = document.createElement('div');
      line.className = 'cal-row';
      line.innerHTML = '<span class="cal-day"></span><span class="cal-name"></span><span class="cal-amt"></span>';
      line.querySelector('.cal-day').textContent = String(row.date.getDate());
      line.querySelector('.cal-name').textContent = row.debt.name;
      line.querySelector('.cal-amt').textContent = host.fmt(row.cents);
      box.appendChild(line);
    }
  }

  /* ---------------- Registrar un pago ---------------- */

  function registerPayment(debt) {
    const parts = split(debt);
    const amount = Math.min(debt.payment, debt.balance + parts.interest);

    if (!confirm(t('ask.registerPayment', { amount: host.fmt(amount), name: debt.name }))) return;

    host.addExpense({
      cents: amount,
      cat: debt.cat || host.debtCat(),
      pay: debt.pay || null,
      note: t('debt.expenseNote', { name: debt.name })
    });

    debt.balance = Math.max(0, debt.balance - parts.capital);
    debt.paid = Array.isArray(debt.paid) ? debt.paid : [];
    debt.paid.push(monthKey(new Date()));
    host.save();
    render();
    host.toast(t('debt.registered'));
  }

  /* ---------------- Alta y edición ---------------- */

  function openSheet(debt, prefill) {
    editing = debt || null;
    $('#debtSheetTitle').textContent = t(debt ? 'debt.edit' : 'debt.new');
    $('#debtDelete').hidden = !debt;

    $('#dName').value = debt ? debt.name : (prefill && prefill.name) || '';
    $('#dKind').value = debt ? debt.kind : (prefill && prefill.kind) || 'loan';
    $('#dPrincipal').value = debt ? money(debt.principal) : '';
    $('#dBalance').value = debt ? money(debt.balance) : '';
    $('#dRate').value = debt && debt.rate ? String(debt.rate).replace('.', host.decimalSep()) : '';
    $('#dTerm').value = debt && debt.term ? debt.term : '';
    $('#dPayment').value = debt ? money(debt.payment) : '';
    $('#dDueDay').value = debt ? debt.dueDay : 1;

    const sel = $('#dPay');
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('debt.noPay');
    sel.appendChild(none);
    for (const p of host.pays()) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = host.payName(p);
      sel.appendChild(o);
    }
    sel.value = debt ? (debt.pay || '') : (prefill && prefill.pay) || '';

    $('#debtSheet').hidden = false;
    $('#debtBackdrop').hidden = false;
  }

  // Alta desde fuera (por ejemplo, tras importar un estado de cuenta) con
  // algunos campos ya puestos.
  function openNew(prefill) {
    openSheet(null, prefill);
  }

  const money = (cents) => (cents / 100).toFixed(2).replace('.', host.decimalSep());

  function readAmount(sel) {
    return host.parseAmount($(sel).value);
  }

  function closeSheet() {
    $('#debtSheet').hidden = true;
    $('#debtBackdrop').hidden = true;
    editing = null;
  }

  // Rellena la cuota a partir de monto, tasa y plazo.
  function calcPayment() {
    const principal = readAmount('#dPrincipal');
    const rate = host.parseNumber($('#dRate').value);
    const term = parseInt($('#dTerm').value, 10);
    if (!principal || !term) return host.toast(t('debt.needCalc'));
    $('#dPayment').value = money(payment(principal, rate, term));
  }

  function saveDebt() {
    const name = $('#dName').value.trim();
    if (!name) return host.toast(t('debt.needName'));

    const principal = readAmount('#dPrincipal');
    const balanceRaw = readAmount('#dBalance');
    const balance = balanceRaw || principal;
    let cuota = readAmount('#dPayment');
    const rate = host.parseNumber($('#dRate').value) || 0;
    const term = parseInt($('#dTerm').value, 10) || 0;

    if (!cuota && principal && term) cuota = payment(principal, rate, term);
    if (!balance) return host.toast(t('debt.needBalance'));
    if (!cuota) return host.toast(t('debt.needPayment'));

    const data = {
      name: name,
      kind: $('#dKind').value,
      principal: principal || balance,
      balance: balance,
      rate: rate,
      term: term,
      payment: cuota,
      dueDay: Math.min(Math.max(parseInt($('#dDueDay').value, 10) || 1, 1), 31),
      pay: $('#dPay').value || null
    };

    if (editing) {
      Object.assign(editing, data);
    } else {
      host.debts().push(Object.assign({ id: host.uid(), paid: [], cat: host.debtCat() }, data));
    }
    host.save();
    closeSheet();
    render();
    host.toast(t(editing ? 'msg.saved' : 'debt.added'));
  }

  function deleteDebt() {
    if (!editing) return;
    if (!confirm(t('ask.deleteDebt', { name: editing.name }))) return;
    host.removeDebt(editing.id);
    closeSheet();
    render();
    host.toast(t('debt.deleted'));
  }

  /* ---------------- Enganches ---------------- */

  function init(bridge) {
    host = bridge;
    $('#debtAdd').addEventListener('click', () => openSheet(null));
    $('#debtCancel').addEventListener('click', closeSheet);
    $('#debtBackdrop').addEventListener('click', closeSheet);
    $('#debtSave').addEventListener('click', saveDebt);
    $('#debtDelete').addEventListener('click', deleteDebt);
    $('#dCalc').addEventListener('click', calcPayment);
  }

  return {
    init: init, render: render, openNew: openNew,
    payment: payment, monthsLeft: monthsLeft, split: split
  };
})();
