/* Presupuesto por rubros: presupuestado contra real, mes a mes.

   Sigue la hoja «Presupuesto» de la plantilla: secciones (Vivienda, Alimentación…) con sus
   rubros, y al final el resumen Ingresos − Gastos de vida − Cuotas de deuda = Queda al mes.

   - «Real» sale de los gastos del mes que llevan ese rubro. Lo que no tiene rubro se enseña
     aparte como «Sin clasificar» y SÍ cuenta en los gastos de vida: nada se esconde.
   - El presupuesto de Deudas no se escribe: es la suma de las cuotas de la pestaña Deudas.
     Su real son los pagos de deuda que registras ahí (rubro «cuotas»).
   - Los montos son del usuario (state.budgetLines, en céntimos); aquí no hay ninguna cifra. */
window.PRESUPUESTO = (() => {
  'use strict';

  let host = null;
  const open = new Set(['__sin']);        // secciones desplegadas
  const $ = (s) => document.querySelector(s);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------------- Cálculo (sin DOM, para poder probarlo) ---------------- */

  function compute(entries, isIncome, lines, debts) {
    const real = new Map();               // rubro -> céntimos
    const sinRubro = [];
    const add = (id, c) => real.set(id, (real.get(id) || 0) + c);
    for (const e of entries) {
      if (e.kind === 'transfer' || e.kind === 'refund') continue;   // mover dinero entre tus cuentas, o un cobro, no es presupuesto
      if (e.recv && e.kind !== 'income') continue;                  // lo por cobrar no es gasto personal: te lo devuelven
      if (e.rubro && window.RUBROS.get(e.rubro)) add(e.rubro, e.cents);
      else if (e.src === 'debt') add(window.RUBROS.DEBT, e.cents);          // pagos de deuda anteriores a los rubros
      else if (!isIncome(e)) sinRubro.push(e);
    }
    const debtBudget = debts.reduce((s, d) => s + (Number.isFinite(d.payment) ? d.payment : 0), 0);

    const groups = window.RUBROS.groups.map((g) => {
      const rubros = window.RUBROS.ofGroup(g.id).map((r) => ({
        id: r.id,
        budget: g.id === 'deu' ? debtBudget : (lines[r.id] || 0),
        real: real.get(r.id) || 0
      }));
      return {
        id: g.id,
        income: !!g.income,
        rubros,
        budget: rubros.reduce((s, r) => s + r.budget, 0),
        real: rubros.reduce((s, r) => s + r.real, 0)
      };
    });
    const by = (id) => groups.find((g) => g.id === id);
    const sinTotal = sinRubro.reduce((s, e) => s + e.cents, 0);
    const life = groups.filter((g) => !g.income && g.id !== 'deu');
    const ingresos = by('ing');
    const deudas = by('deu');
    const vidaBudget = life.reduce((s, g) => s + g.budget, 0);
    const vidaReal = life.reduce((s, g) => s + g.real, 0) + sinTotal;
    return {
      groups, sinRubro, sinTotal,
      summary: {
        ingresos: { budget: ingresos.budget, real: ingresos.real },
        vida: { budget: vidaBudget, real: vidaReal },
        deudas: { budget: deudas.budget, real: deudas.real },
        queda: {
          budget: ingresos.budget - vidaBudget - deudas.budget,
          real: ingresos.real - vidaReal - deudas.real
        }
      }
    };
  }

  /* ---------------- Dibujo ---------------- */

  function bar(real, budget, income) {
    const wrap = el('div', 'bud-bar');
    const fill = el('div', 'bud-fill');
    const pct = budget > 0 ? Math.min(100, Math.round((real / budget) * 100)) : (real > 0 ? 100 : 0);
    fill.style.width = pct + '%';
    if (!income && budget > 0 && real > budget) fill.classList.add('over');
    else if (!income && budget > 0 && pct >= 85) fill.classList.add('warn');
    else if (!income && budget === 0 && real > 0) fill.classList.add('nobudget');
    wrap.appendChild(fill);
    return wrap;
  }

  function summaryRow(label, a, strong) {
    const row = el('div', 'bud-sum' + (strong ? ' strong' : ''));
    row.appendChild(el('span', 'bud-sum-l', label));
    row.appendChild(el('span', 'bud-sum-r', host.fmt(a.real)));
    row.appendChild(el('span', 'bud-sum-b', a.budget ? host.t('bud.of', { n: host.fmt(a.budget) }) : ''));
    if (strong && a.real < 0) row.classList.add('neg');
    return row;
  }

  function editLine(rubro) {
    const name = window.RUBROS.name(rubro.id);
    const cur = host.lines()[rubro.id] || 0;
    const answer = prompt(host.t('bud.edit', { name }), cur ? host.amountText(cur) : '');
    if (answer === null) return;
    const cents = host.parseAmount(answer);
    if (!Number.isFinite(cents) || cents < 0) return host.toast(host.t('bud.invalid'));
    host.setLine(rubro.id, cents);
    render();
  }

  function render() {
    const body = $('#budgetBody');
    if (!body || !host) return;
    $('#monthName3').textContent = host.monthLabel();
    const c = compute(host.entries(host.month()), host.isIncome, host.lines(), host.debts());
    body.textContent = '';

    const card = el('div', 'bud-card');
    card.appendChild(summaryRow(host.t('bud.income'), c.summary.ingresos));
    card.appendChild(summaryRow(host.t('bud.life'), c.summary.vida));
    card.appendChild(summaryRow(host.t('bud.debts'), c.summary.deudas));
    card.appendChild(summaryRow(host.t('bud.left'), c.summary.queda, true));
    body.appendChild(card);

    if (!Object.keys(host.lines()).length) body.appendChild(el('p', 'note', host.t('bud.hint.empty')));

    if (c.sinRubro.length) {
      const key = '__sin';
      const head = el('button', 'bud-group sin');
      head.type = 'button';
      head.appendChild(el('span', 'bud-g-name', '❓ ' + host.t('bud.unclassified', { n: c.sinRubro.length })));
      head.appendChild(el('span', 'bud-g-nums', host.fmt(c.sinTotal)));
      head.addEventListener('click', () => { open.has(key) ? open.delete(key) : open.add(key); render(); });
      body.appendChild(head);
      if (open.has(key)) {
        const list = el('div', 'group');
        for (const e of c.sinRubro.slice().sort((a, b) => b.cents - a.cents)) {
          const row = el('button', 'row action');
          row.type = 'button';
          row.appendChild(el('span', null, (e.note || e.date)));
          row.appendChild(el('span', 'chev', host.fmt(e.cents)));
          row.addEventListener('click', () => host.openExpense(e.id));
          list.appendChild(row);
        }
        body.appendChild(list);
        body.appendChild(el('p', 'note', host.t('bud.hint.unclassified')));
      }
    }

    for (const g of c.groups) {
      const meta = window.RUBROS.group(g.id);
      const head = el('button', 'bud-group' + (open.has(g.id) ? ' open' : ''));
      head.type = 'button';
      head.appendChild(el('span', 'bud-g-name', meta.icon + ' ' + window.RUBROS.groupName(g.id)));
      head.appendChild(el('span', 'bud-g-nums', host.fmt(g.real) + (g.budget ? ' / ' + host.fmt(g.budget) : '')));
      head.appendChild(bar(g.real, g.budget, g.income));
      head.addEventListener('click', () => { open.has(g.id) ? open.delete(g.id) : open.add(g.id); render(); });
      body.appendChild(head);
      if (!open.has(g.id)) continue;

      const box = el('div', 'group');
      for (const r of g.rubros) {
        const row = el('div', 'bud-rubro');
        row.appendChild(el('span', 'bud-r-name', window.RUBROS.name(r.id)));
        row.appendChild(el('span', 'bud-r-real', host.fmt(r.real)));
        const b = el('button', 'bud-r-budget', r.budget ? host.fmt(r.budget) : host.t('bud.set'));
        b.type = 'button';
        if (g.id === 'deu') b.disabled = true;                 // sale de la pestaña Deudas
        else b.addEventListener('click', () => editLine(r));
        row.appendChild(b);
        row.appendChild(bar(r.real, r.budget, g.income));
        box.appendChild(row);
      }
      body.appendChild(box);
      if (g.id === 'deu') body.appendChild(el('p', 'note', host.t('bud.hint.debts')));
    }
    body.appendChild(el('div', 'bottom-pad'));
  }

  function init(bridge) {
    host = bridge;                  // se dibuja en el primer renderAll de app.js
  }

  return { init, render, compute };
})();
