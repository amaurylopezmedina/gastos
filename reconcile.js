/* Conciliación: comparar un estado de cuenta con lo que ya está apuntado.

   No importa nada por su cuenta. Responde a tres preguntas:
   - qué movimientos del banco ya tienes apuntados,
   - qué te falta por apuntar,
   - qué tienes apuntado que el banco no cobró (error, duplicado, o un gasto
     que pagaste por otra vía).

   Cuadrar por firma exacta solo funcionaría con lo que vino del propio PDF: un
   gasto escrito a mano dice "Súper" donde el banco dice "JUMBO MOCA MOCA-DO",
   y la fecha puede bailar un par de días entre la compra y el cargo. Por eso
   el emparejado es por importe con margen de días. */
window.RECONCILE = (() => {
  'use strict';

  const DAY_MS = 86400000;
  const DAY_WINDOW = 4;          // margen entre fecha de compra y de cargo

  let host = null;
  let result = null;             // último análisis
  let payFilter = '';            // forma de pago con la que se compara

  const $ = (s) => document.querySelector(s);
  const t = (k, v) => window.I18N.t(k, v);
  const tn = (k, n, v) => window.I18N.tn(k, n, v);

  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const daysApart = (a, b) => Math.abs(parseDate(a) - parseDate(b)) / DAY_MS;

  /* ---------------- Análisis ---------------- */

  function analyse(rows) {
    // Los pagos a la tarjeta no son gastos: no entran en la comparación.
    const bank = rows.filter((r) => !r.credit && !r.repeated && r.currency === host.currency());

    const from = bank.reduce((min, r) => (r.date < min ? r.date : min), bank[0].date);
    const to = bank.reduce((max, r) => (r.date > max ? r.date : max), bank[0].date);

    // Lo apuntado en el periodo, de la forma de pago que se está conciliando.
    const mine = host.expenses().filter((e) => {
      if (e.date < from || e.date > to) return false;
      return payFilter ? e.pay === payFilter : true;
    });

    const used = new Set();
    const matched = [];
    const missing = [];

    for (const row of bank) {
      // Primero la firma exacta: lo que salió de un PDF cuadra sin dudas.
      let hit = mine.find((e) => !used.has(e.id) && e.sig === row.sig);

      // Si no, mismo importe y fecha cercana; se prefiere el día más próximo.
      if (!hit) {
        const cands = mine
          .filter((e) => !used.has(e.id) && e.cents === row.cents && daysApart(e.date, row.date) <= DAY_WINDOW)
          .sort((a, b) => daysApart(a.date, row.date) - daysApart(b.date, row.date));
        hit = cands[0];
      }

      if (hit) {
        used.add(hit.id);
        matched.push({ row: row, expense: hit });
      } else {
        missing.push(row);
      }
    }

    const extra = mine.filter((e) => !used.has(e.id));

    return {
      from: from,
      to: to,
      bank: bank,
      matched: matched,
      missing: missing,
      extra: extra,
      bankTotal: bank.reduce((s, r) => s + r.cents, 0),
      mineTotal: mine.reduce((s, e) => s + e.cents, 0),
      missingTotal: missing.reduce((s, r) => s + r.cents, 0),
      extraTotal: extra.reduce((s, e) => s + e.cents, 0)
    };
  }

  /* ---------------- Interfaz ---------------- */

  async function open(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const parsed = await window.STATEMENT.parseFiles(files, (n, total) => {
      host.toast(total > 1 ? t('imp.readingOne', { n: n, total: total }) : t('imp.reading'));
    });
    if (!parsed.rows.length) {
      return host.toast(t(parsed.failed ? 'imp.failed' : 'imp.nothing'));
    }

    // Por defecto se concilia contra la tarjeta del propio estado de cuenta.
    const proposed = parsed.card ? t('imp.cardName', { n: parsed.card }) : null;
    const match = proposed ? host.pays().find((p) => host.payName(p) === proposed) : null;
    payFilter = match ? match.id : '';

    fillPaySelect();
    window.__recRows = parsed.rows;
    run();

    $('#recSheet').hidden = false;
    $('#recBackdrop').hidden = false;
    $('#recSheet').scrollTop = 0;
  }

  function fillPaySelect() {
    const sel = $('#recPay');
    sel.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = t('rec.allPays');
    sel.appendChild(all);
    for (const p of host.pays()) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = host.payName(p);
      sel.appendChild(o);
    }
    sel.value = payFilter;
  }

  function run() {
    result = analyse(window.__recRows);
    render();
  }

  function render() {
    $('#recPeriod').textContent = t('rec.period', {
      from: host.dayLabel(result.from), to: host.dayLabel(result.to)
    });

    $('#recBank').textContent = host.fmt(result.bankTotal);
    $('#recMine').textContent = host.fmt(result.mineTotal);

    const diff = result.bankTotal - result.mineTotal;
    const diffEl = $('#recDiff');
    diffEl.textContent = (diff > 0 ? '+' : '') + host.fmt(diff);
    diffEl.className = 'card-value ' + (diff === 0 ? 'down' : 'up');

    $('#recVerdict').textContent = result.missing.length === 0 && result.extra.length === 0
      ? t('rec.allGood', { n: result.matched.length })
      : t('rec.summary', {
          ok: result.matched.length, missing: result.missing.length, extra: result.extra.length
        });

    // Falta por apuntar
    group($('#recMissing'), $('#recMissingTitle'), result.missing.length,
      t('rec.missing', { n: result.missing.length, total: host.fmt(result.missingTotal) }),
      result.missing.map((row) => ({
        title: row.desc,
        meta: host.dayLabel(row.date),
        amount: host.fmt(row.cents)
      })));
    $('#recAdd').hidden = result.missing.length === 0;
    $('#recAdd').textContent = tn('rec.addMissing', result.missing.length);

    // Apuntado pero no cobrado
    group($('#recExtra'), $('#recExtraTitle'), result.extra.length,
      t('rec.extra', { n: result.extra.length, total: host.fmt(result.extraTotal) }),
      result.extra.map((e) => ({
        title: e.note || host.catName(e.cat),
        meta: host.dayLabel(e.date) + (e.note ? '  ·  ' + host.catName(e.cat) : ''),
        amount: host.fmt(e.cents),
        id: e.id
      })), true);

    // Cuadran
    group($('#recMatched'), $('#recMatchedTitle'), result.matched.length,
      t('rec.matched', { n: result.matched.length }),
      result.matched.map((m) => ({
        title: m.row.desc,
        meta: host.dayLabel(m.row.date) + '  ↔  ' + (m.expense.note || host.catName(m.expense.cat)),
        amount: host.fmt(m.row.cents)
      })));
  }

  function group(box, title, count, titleText, items, clickable) {
    title.textContent = titleText;
    title.hidden = count === 0;
    box.hidden = count === 0;
    box.textContent = '';
    for (const item of items) {
      const el = document.createElement(clickable ? 'button' : 'div');
      el.className = 'rec-row';
      el.innerHTML = '<span class="rec-main"><b></b><small></small></span><span class="rec-amt"></span>';
      el.querySelector('b').textContent = item.title;
      el.querySelector('small').textContent = item.meta;
      el.querySelector('.rec-amt').textContent = item.amount;
      if (clickable && item.id) el.onclick = () => host.editExpense(item.id);
      box.appendChild(el);
    }
  }

  function addMissing() {
    if (!result || !result.missing.length) return;
    if (!confirm(t('ask.addMissing', {
      n: result.missing.length, total: host.fmt(result.missingTotal)
    }))) return;

    host.addImported(result.missing.map((row) => ({
      cents: row.cents,
      cat: window.STATEMENT.suggestCat(row.desc),
      pay: payFilter || null,
      date: row.date,
      note: row.desc,
      sig: row.sig,
      file: row.file
    })));
    close();
  }

  function close() {
    $('#recSheet').hidden = true;
    $('#recBackdrop').hidden = true;
    result = null;
    window.__recRows = null;
  }

  function init(bridge) {
    host = bridge;
    $('#recClose').addEventListener('click', close);
    $('#recBackdrop').addEventListener('click', close);
    $('#recAdd').addEventListener('click', addMissing);
    $('#recPay').addEventListener('change', (ev) => {
      payFilter = ev.target.value;
      run();
    });
  }

  return { init: init, open: open };
})();
