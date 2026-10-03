/* Cuentas bancarias (ahorro, corriente, nómina) y cobertura de datos.

   Una cuenta es una «forma de pago» con kind:'account'. Así la usan sin cambios los gastos, los
   ingresos, la importación de estados y la bandeja de facturas:
     { id, icon, name:'BHD ···1234', kind:'account', bank:'BHD', number:'00112233 1234', opening: céntimos, openingDate:'2026-10-03' }
   - `number` es el número completo (solo vive en los datos del usuario, nunca en el repo); el nombre enseña los 4
     últimos. Mientras no se sepa se deja 000000 (se edita tocando la cuenta).
   - Saldo = saldo conocido + ingresos y transferencias recibidas − gastos y transferencias enviadas, contando SOLO los
     movimientos posteriores a `openingDate`: lo anterior ya está dentro del saldo conocido, y así se puede importar el
     historial de meses pasados sin contarlo dos veces. Sin fecha, cuentan todos (compatibilidad).
   - Las tarjetas no tocan el saldo de una cuenta: pagar la tarjeta sí, y es un gasto con rubro «cuotas».
   - La tabla «Hasta qué día hay datos» enseña, por cuenta y tarjeta, el último movimiento cargado,
     para saber de un vistazo qué falta por importar. */
window.CUENTAS = (() => {
  'use strict';

  const PENDING = '000000';
  const cleanNumber = (raw) => String(raw || '').replace(/\D/g, '').slice(-20) || PENDING;
  // Nombre visible: banco + 4 últimos dígitos (o el 000000 mientras no haya número).
  const nameOf = (bank, number) => bank + ' ···' + (/^0+$/.test(number) ? number : number.slice(-4));
  const todayIso = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  // Acepta AAAA-MM-DD o DD/MM/AAAA.
  function parseDate(text) {
    const s = String(text || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null;
  }
  let host = null;
  const $ = (s) => document.querySelector(s);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const accounts = () => host.pays().filter((p) => p.kind === 'account');

  /* ---------------- Cálculo (sin DOM) ---------------- */

  function statsOf(pay, expenses) {
    let last = null;
    let n = 0;
    let delta = 0;
    const since = pay.openingDate || null;
    const sinceTs = pay.openingTs || 0;      // conteo de efectivo «ahora mismo»: lo apuntado ese mismo día DESPUÉS sí cuenta
    for (const e of expenses) {
      const incoming = e.kind === 'transfer' && e.to === pay.id;     // llega dinero desde otra cuenta
      if (e.pay !== pay.id && !incoming) continue;
      n++;
      if (!last || e.date > last) last = e.date;
      if (since && (e.date < since || (e.date === since && !(sinceTs && (e.ts || 0) > sinceTs)))) continue;   // ya está dentro del saldo conocido
      delta += incoming || e.kind === 'income' ? e.cents : -e.cents;  // sale: gasto o transferencia enviada
    }
    return { last, n, balance: (Number.isFinite(pay.opening) ? pay.opening : 0) + delta };
  }

  // Filas de la tabla de cobertura: cuentas, tarjetas con movimientos y tarjetas de Deudas sin movimientos.
  function coverage(pays, expenses, debts) {
    const rows = [];
    const used = new Set();
    for (const p of pays) {
      const s = statsOf(p, expenses);
      if (p.kind !== 'account' && p.kind !== 'card' && !s.n) continue;
      if (p.id === 'efectivo' || p.id === 'transfer' || p.id === 'tarjeta') continue;
      used.add(p.id);
      rows.push({ id: p.id, name: p.name, kind: p.kind || 'card', last: s.last, n: s.n, balance: p.kind === 'account' ? s.balance : null });
    }
    for (const d of debts) {
      if (d.kind !== 'card' || (d.pay && used.has(d.pay))) continue;
      rows.push({ id: 'debt:' + d.id, name: d.name, kind: 'card', last: null, n: 0, balance: null });
    }
    return rows;
  }

  /* ---------------- Dibujo ---------------- */

  function dateText(iso) {
    return iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  }

  function editAccount(pay) {
    const number = prompt(host.t('acct.editNumber', { name: pay.name }), pay.number || PENDING);
    if (number === null) return;
    const opening = prompt(host.t('acct.editOpening', { name: pay.name }), host.amountText(pay.opening || 0));
    if (opening === null) return;
    const cents = host.parseAmount(opening);
    if (!Number.isFinite(cents)) return host.toast(host.t('bud.invalid'));
    const when = prompt(host.t('acct.editDate', { name: pay.name }), pay.openingDate || todayIso());
    if (when === null) return;
    const iso = parseDate(when);
    if (!iso) return host.toast(host.t('acct.badDate'));
    pay.number = cleanNumber(number);
    pay.opening = cents;
    pay.openingDate = iso;
    // Un saldo fijado con la fecha de HOY es «ahora mismo»: lo que apuntes hoy después sí lo cambia.
    // Con una fecha pasada es el saldo al cierre de ese día.
    if (iso === todayIso()) pay.openingTs = Date.now(); else delete pay.openingTs;
    pay.name = nameOf(pay.bank, pay.number);
    host.save();
    host.renderAll();
  }

  function addAccount() {
    const bank = $('#acctBank').value.trim().slice(0, 20);
    if (!bank) return host.toast(host.t('acct.needBank'));
    const number = cleanNumber($('#acctNumber').value);
    const cents = $('#acctOpening').value.trim() ? host.parseAmount($('#acctOpening').value) : 0;
    if (!Number.isFinite(cents)) return host.toast(host.t('bud.invalid'));
    host.addPay({ icon: '\u{1F3E6}', name: nameOf(bank, number), kind: 'account', bank: bank, number: number, opening: cents, openingDate: todayIso(), openingTs: Date.now() });
    $('#acctBank').value = '';
    $('#acctNumber').value = '';
    $('#acctOpening').value = '';
    host.renderAll();
    host.toast(host.t('acct.added'));
  }

  function render() {
    const box = $('#acctBox');
    if (!box || !host) return;
    const expenses = host.expenses();
    box.textContent = '';

    box.appendChild(el('h2', 'section-title', host.t('acct.title')));
    const list = el('div', 'group');
    const accts = accounts();
    if (!accts.length) list.appendChild(el('p', 'note', host.t('acct.empty')));
    for (const p of accts) {
      const s = statsOf(p, expenses);
      const row = el('button', 'row action');
      row.type = 'button';
      const left = el('span', null, '\u{1F3E6} ' + p.name);
      if (!p.number || /^0+$/.test(p.number)) left.appendChild(el('small', 'acct-pending', '  ' + host.t('acct.pending')));
      if (p.openingDate) left.appendChild(el('small', 'acct-asof', '  ' + host.t('acct.asOf', { d: dateText(p.openingDate).slice(0, 5) })));
      row.appendChild(left);
      row.appendChild(el('span', 'chev', host.fmt(s.balance)));
      row.addEventListener('click', () => editAccount(p));
      list.appendChild(row);
    }
    box.appendChild(list);

    const form = el('form', 'group acct-form');
    const bank = el('input'); bank.id = 'acctBank'; bank.maxLength = 20; bank.placeholder = host.t('acct.bank');
    const number = el('input'); number.id = 'acctNumber'; number.inputMode = 'numeric'; number.maxLength = 20; number.placeholder = PENDING;
    const opening = el('input'); opening.id = 'acctOpening'; opening.inputMode = 'decimal'; opening.placeholder = host.t('acct.opening');
    const add = el('button', null, host.t('set.add')); add.type = 'submit';
    form.append(bank, number, opening, add);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); addAccount(); });
    box.appendChild(form);
    box.appendChild(el('p', 'note', host.t('acct.hint')));

    /* ---- Cobertura ---- */
    const cov = $('#covBox');
    cov.textContent = '';
    cov.appendChild(el('h2', 'section-title', host.t('cov.title')));
    const table = el('div', 'group');
    const rows = coverage(host.pays(), expenses, host.debts());
    if (!rows.length) table.appendChild(el('p', 'note', host.t('cov.empty')));
    for (const r of rows.sort((a, b) => (a.last || '') < (b.last || '') ? 1 : -1)) {
      const row = el('div', 'row cov-row');
      row.appendChild(el('span', null, (r.kind === 'account' ? '\u{1F3E6} ' : '\u{1F4B3} ') + r.name));
      row.appendChild(el('span', 'chev' + (r.last ? '' : ' cov-none'), r.last ? dateText(r.last) : host.t('cov.none')));
      table.appendChild(row);
    }
    cov.appendChild(table);
    cov.appendChild(el('p', 'note', host.t('cov.hint')));
  }

  function init(bridge) {
    host = bridge;
  }

  return { init, render, statsOf, coverage };
})();
