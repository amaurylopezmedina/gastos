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
    const debts = host.debts().filter((d) => d.balance > 0);
    const byKind = (kind) => debts.filter((d) => d.kind === kind).reduce((s, d) => s + d.balance, 0);
    return {
      balance: debts.reduce((s, d) => s + d.balance, 0),
      cards: byKind('card'),
      loans: byKind('loan'),
      monthly: debts.reduce((s, d) => s + d.payment, 0),
      // Lo que queda por pagar de este mes: las cuotas aún no registradas.
      pending: debts.filter((d) => !paidThisMonth(d)).reduce((s, d) => s + d.payment, 0),
      interest: debts.reduce((s, d) => s + split(d).interest, 0),
      count: debts.length
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

    const parts = [];
    if (sum.cards) parts.push(t('debt.cards', { amount: host.fmt(sum.cards) }));
    if (sum.loans) parts.push(t('debt.loans', { amount: host.fmt(sum.loans) }));
    $('#debtSplit').textContent = parts.join('  ·  ');

    $('#debtMonthly').textContent = host.fmt(sum.monthly);
    $('#debtPending').textContent = host.fmt(sum.pending);
    $('#debtInterest').textContent = host.fmt(sum.interest);

    const next = schedule(1)[0];
    $('#debtNext').textContent = next ? host.fmt(next.cents) : '—';
    $('#debtNextWhen').textContent = next ? whenLabel(next.date) : '';

    renderAlerts();
    renderList(debts);
    renderMonthCalendar();
    $('#debtEmpty').hidden = debts.length > 0;
    $('#debtIcs').hidden = sum.count === 0;
  }

  /* ---------------- Avisos ---------------- */

  /* Lo más cerca de un recordatorio que puede dar la propia app: al abrirla,
     avisa de lo que vence pronto o ya venció. Para que avise con la app
     cerrada está la exportación al calendario del teléfono. */
  function renderAlerts() {
    const box = $('#debtAlerts');
    box.textContent = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const debt of host.debts()) {
      if (debt.balance <= 0 || paidThisMonth(debt)) continue;
      const due = dueDate(debt, 0);
      const days = Math.round((due - today) / DAY);
      if (days > 3) continue;

      const el = document.createElement('div');
      el.className = 'alert' + (days < 0 ? ' late' : '');
      el.innerHTML = '<span class="alert-ico"></span><span class="alert-text"></span>';
      el.querySelector('.alert-ico').textContent = days < 0 ? '⚠️' : '⏰';
      el.querySelector('.alert-text').textContent = t(days < 0 ? 'debt.alert.late' : 'debt.alert.soon', {
        name: debt.name, amount: host.fmt(debt.payment), when: whenLabel(due)
      });
      box.appendChild(el);
    }
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

  /* ---------------- Calendario mensual ---------------- */

  let calCursor = new Date();       // mes que muestra la cuadrícula

  function renderMonthCalendar() {
    const rows = schedule(24);      // dos años por delante: basta para navegar
    const has = rows.length > 0;
    $('#debtCalendarTitle').hidden = !has;
    $('#debtCalendarBox').hidden = !has;
    if (!has) return;

    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    const key = monthKey(calCursor);
    const mine = rows.filter((r) => monthKey(r.date) === key);

    $('#calMonthName').textContent = host.monthLabel(calCursor);
    $('#calMonthTotal').textContent = mine.length
      ? host.fmt(mine.reduce((s, r) => s + r.cents, 0))
      : t('debt.noPayments');

    // Cabecera de días: se toman del idioma, empezando en lunes.
    const week = $('#calWeekdays');
    week.textContent = '';
    for (const name of host.weekdayNames()) {
      const el = document.createElement('span');
      el.textContent = name;
      week.appendChild(el);
    }

    const grid = $('#calGrid');
    grid.textContent = '';

    // Hueco inicial: lunes = 0.
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    for (let i = 0; i < firstWeekday; i++) {
      grid.appendChild(document.createElement('span'));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= lastDay(year, month); day++) {
      const date = new Date(year, month, day);
      const payments = mine.filter((r) => r.date.getDate() === day);
      const cell = document.createElement('span');
      cell.className = 'calday';
      if (payments.length) cell.classList.add('has');
      if (payments.length && date < today) cell.classList.add('late');
      if (date.getTime() === today.getTime()) cell.classList.add('today');
      cell.innerHTML = '<b></b><i></i>';
      cell.querySelector('b').textContent = String(day);
      if (payments.length > 1) cell.querySelector('i').textContent = String(payments.length);
      grid.appendChild(cell);
    }

    // Detalle del mes bajo la cuadrícula.
    const box = $('#debtCalendar');
    box.textContent = '';
    for (const row of mine) {
      const line = document.createElement('div');
      line.className = 'cal-row';
      line.innerHTML = '<span class="cal-day"></span><span class="cal-name"></span><span class="cal-amt"></span>';
      line.querySelector('.cal-day').textContent = String(row.date.getDate());
      line.querySelector('.cal-name').textContent = row.debt.name;
      line.querySelector('.cal-amt').textContent = host.fmt(row.cents);
      box.appendChild(line);
    }
  }

  function shiftCalendar(n) {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + n, 1);
    renderMonthCalendar();
  }

  /* ---------------- Recordatorios en el calendario del teléfono ---------------- */

  /* Una PWA no puede programar avisos que salten con la app cerrada: iOS no
     lo permite sin un servidor que empuje las notificaciones. Lo que sí
     funciona es entregar los pagos al calendario del propio teléfono, que
     avisa por su cuenta. */
  function icsDate(d) {
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function exportIcs() {
    const debts = host.debts().filter((d) => d.balance > 0);
    if (!debts.length) return;

    const now = new Date();
    const stamp = icsDate(now) + 'T090000Z';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Gastos//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    for (const debt of debts) {
      const first = dueDate(debt, 0);
      const left = monthsLeft(debt);
      const count = Math.min(left === null ? 60 : left, 120);
      const title = t('debt.icsTitle', { name: debt.name, amount: host.fmt(debt.payment) });

      lines.push(
        'BEGIN:VEVENT',
        'UID:' + debt.id + '@gastos',
        'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + icsDate(first),
        'DURATION:P1D',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=' + Math.min(debt.dueDay || 1, 28) + ';COUNT=' + count,
        'SUMMARY:' + escapeIcs(title),
        'DESCRIPTION:' + escapeIcs(t('debt.icsBody', { name: debt.name, amount: host.fmt(debt.payment) })),
        'BEGIN:VALARM',
        'TRIGGER:-P1D',
        'ACTION:DISPLAY',
        'DESCRIPTION:' + escapeIcs(title),
        'END:VALARM',
        'END:VEVENT'
      );
    }

    lines.push('END:VCALENDAR');
    host.download('pagos.ics', lines.join('\r\n'), 'text/calendar');
    host.toast(t('debt.icsDone'));
  }

  const escapeIcs = (s) => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

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
    $('#debtIcs').addEventListener('click', exportIcs);
    for (const b of document.querySelectorAll('[data-calmonth]')) {
      b.addEventListener('click', () => shiftCalendar(Number(b.dataset.calmonth)));
    }
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
