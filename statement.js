/* Importador de estados de cuenta en PDF.

   Todo ocurre en el teléfono: el PDF se lee con pdf.js servido desde este
   mismo sitio (carpeta vendor/), nunca se sube a ningún servidor.

   El texto plano de un estado de cuenta no distingue un consumo de un pago,
   porque ambos son "una fecha, un concepto y un número". Lo que sí los
   distingue es la COLUMNA: pdf.js da la posición de cada texto, y los
   créditos caen más a la derecha que los consumos. */
window.STATEMENT = (() => {
  'use strict';

  let host = null;          // puente con app.js
  let parsed = [];          // movimientos detectados
  let rate = 0;             // tasa de cambio para la moneda extranjera
  let fileName = '';        // nombre del PDF, para poder deshacer la carga

  const $ = (s) => document.querySelector(s);
  const t = (k, v) => window.I18N.t(k, v);

  /* ---------------- Carga perezosa de pdf.js ---------------- */

  let pdfReady = null;
  function loadPdfJs() {
    if (!pdfReady) {
      pdfReady = new Promise((resolve, reject) => {
        if (window.pdfjsLib) return resolve(window.pdfjsLib);
        const s = document.createElement('script');
        s.src = 'vendor/pdf.min.js';
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        s.onerror = () => reject(new Error('pdf.js'));
        document.head.appendChild(s);
      });
    }
    return pdfReady;
  }

  /* ---------------- Lectura del PDF ---------------- */

  const DATE_RE = /^(\d{2})[/-](\d{2})[/-](\d{4})$/;
  const AMOUNT_RE = /^-?\(?[\d][\d.,]*\)?-?$/;

  function parseAmount(raw) {
    const s = raw.replace(/[^\d.,-]/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const dec = Math.max(lastComma, lastDot);
    // Dos dígitos tras el último separador = parte decimal (da igual si el
    // banco escribe 10,275.09 o 10.275,09).
    if (dec >= 0 && s.length - dec - 1 === 2) {
      const int = s.slice(0, dec).replace(/[.,]/g, '');
      return Math.round(Number(int + '.' + s.slice(dec + 1)) * 100);
    }
    const n = Number(s.replace(/[.,]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }

  function isoDate(m) {
    const [, d, mo, y] = m;
    return y + '-' + mo + '-' + d;
  }

  // Detecta la moneda que anuncia una cabecera de sección.
  function sectionCurrency(text) {
    const s = text.toUpperCase();
    if (/\bUS\$|DOLAR|DOLLAR|USD\b/.test(s)) return 'USD';
    if (/\bRD\$|PESOS DOMINICANOS|\bDOP\b/.test(s)) return 'DOP';
    if (/\bEUR\b|\bEUROS\b/.test(s)) return 'EUR';
    if (/\bMXN\b|PESOS MEXICANOS/.test(s)) return 'MXN';
    return null;
  }

  async function readPdf(file) {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;

    const rows = [];
    let currency = null;

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();

      // Agrupa los fragmentos de texto en líneas por su coordenada vertical.
      const lines = new Map();
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 3);
        const bucket = key === undefined ? (lines.set(y, []), lines.get(y)) : lines.get(key);
        bucket.push({ x: item.transform[4], w: item.width || 0, s: item.str.trim() });
      }

      const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, v]) => v);

      for (const items of ordered) {
        items.sort((a, b) => a.x - b.x);
        const whole = items.map((i) => i.s).join(' ');

        const declared = sectionCurrency(whole);
        if (declared && /TRANSACCION|MOVIMIENT|DETALLE|CONSUMO/i.test(whole)) {
          currency = declared;           // cabecera de sección
          continue;
        }
        if (/TOTAL|SALDO ANTERIOR|BALANCE ANTERIOR|\*\*/i.test(whole)) continue;

        const dates = [];
        const amounts = [];
        const words = [];
        for (const it of items) {
          const d = it.s.match(DATE_RE);
          if (d) { dates.push(d); continue; }
          if (AMOUNT_RE.test(it.s) && /[.,]\d{2}$/.test(it.s)) {
            const cents = parseAmount(it.s);
            if (Number.isFinite(cents)) { amounts.push({ cents, right: it.x + it.w, raw: it.s }); continue; }
          }
          if (/^\d{3,4}$/.test(it.s)) continue;     // últimos dígitos de la tarjeta
          words.push(it.s);
        }

        if (!dates.length || amounts.length !== 1) continue;
        const desc = words.join(' ').replace(/\s+/g, ' ').trim();
        if (!desc) continue;

        rows.push({
          date: isoDate(dates[0]),
          desc: desc,
          cents: amounts[0].cents,
          right: amounts[0].right,
          currency: currency
        });
      }
    }

    // Consumos y créditos viven en columnas distintas: las de la derecha son
    // pagos y abonos, que no son gastos.
    const rights = rows.map((r) => r.right);
    if (rights.length) {
      const max = Math.max(...rights);
      const min = Math.min(...rights);
      const threshold = max - min > 20 ? max - 15 : Infinity;
      for (const r of rows) r.credit = r.right >= threshold;
    }

    // Últimos dígitos de la tarjeta, para nombrar la forma de pago.
    let card = null;
    const firstPage = await doc.getPage(1);
    const head = (await firstPage.getTextContent()).items.map((i) => i.str).join(' ');
    const m = head.match(/(\d{4})\s*[*x·•]{2,}\s*(\d{4})|[*x·•]{4,}\s*(\d{4})/i);
    if (m) card = m[2] || m[3];

    return { rows: rows, card: card };
  }

  /* ---------------- Categoría sugerida ---------------- */

  // Se busca por palabras del comercio. Lo que no encaje queda en "Otros" y
  // el usuario lo corrige en la lista antes de importar.
  const RULES = [
    ['super',    /JUMBO|SIRENA|SUPERMERCAD|COOPCIBAO|PLAZA LAMA|BRAVO|NACIONAL|OLE|MERCADO|GROCER|WALMART|CARREFOUR|MERCADONA/],
    ['comida',   /BURGER|PIZZA|HELADO|RESTAUR|CAFE|COFFEE|MCDONALD|WENDY|KFC|DOMINO|SUBWAY|TERIYAKI|SUSHI|BON |BOMBAZO|PANADER|REPOSTER|DELI|BAR |TACO|FOOD/],
    ['transpor', /TEXACO|SHELL|ESSO|SUNIX|ESTACION|GASOLIN|COMBUSTIB|UBER|TAXI|AERODOM|AIRLIN|AVIANCA|PARQUEO|PEAJE|PASSPORT|TRANSPORT|METRO|CARIBE TOURS/],
    ['casa',     /EDENORTE|EDESUR|EDEESTE|CLARO|ALTICE|VIVA|TRICOM|CAASD|CORAA|INAPA|IKEA|FERRETER|CONDOMINIO|MUEBL|HOGAR|HOME|DEPOT/],
    ['salud',    /FARMACIA|CAROL|GBC|MEDIC|CLINIC|HOSPITAL|LABORATORI|DENTAL|OPTIC|SALUD|PHARMA/],
    ['ropa',     /TIENDA|ZARA|BOUTIQUE|SHOES|CALZADO|ROPA|MODA|FASHION|PAYLESS|ADIDAS|NIKE/],
    ['subs',     /NETFLIX|SPOTIFY|ANTHROPIC|OPENAI|CLAUDE|APPLE\.COM|ITUNES|GOOGLE|MICROSOFT|ADOBE|PRIME|DISNEY|HBO|YOUTUBE|DROPBOX|ICLOUD|SUBSCRIPTION|SUB /],
    ['banco',   /COMISION|INTERES|INTERES|AVANCE|MORA|CARGO POR|SEGURO|AHORRO|IMPUESTO|ITBIS|0\.15|CUOTA MANEJO|MANTENIMIENTO/]
  ];

  function suggestCat(desc) {
    const s = desc.toUpperCase();
    for (const [id, re] of RULES) {
      if (re.test(s) && host.hasCat(id)) return id;
    }
    return host.hasCat('otros') ? 'otros' : host.firstCat();
  }

  /* ---------------- Firma para no duplicar ---------------- */

  const signature = (row) => row.date + '|' + row.cents + '|' + row.desc.slice(0, 24).toUpperCase();

  /* ---------------- Interfaz de revisión ---------------- */

  async function open(file) {
    fileName = (file && file.name) || 'PDF';
    host.toast(t('imp.reading'));
    let result;
    try {
      result = await readPdf(file);
    } catch (err) {
      return host.toast(t('imp.failed'));
    }
    if (!result.rows.length) return host.toast(t('imp.nothing'));

    const known = host.signatures();
    parsed = result.rows.map((r) => {
      const sig = signature(r);
      const dup = known.has(sig);
      return {
        date: r.date,
        desc: r.desc,
        cents: r.cents,
        currency: r.currency || host.currency(),
        credit: Boolean(r.credit),
        dup: dup,
        sig: sig,
        cat: suggestCat(r.desc),
        // Un pago a la tarjeta no es un gasto, y un duplicado ya está apuntado.
        on: !r.credit && !dup
      };
    });

    rate = 0;
    prepareCard(result.card);
    render();
    $('#impSheet').hidden = false;
    $('#impBackdrop').hidden = false;
  }

  // Si el estado de cuenta trae los últimos dígitos, se propone una forma de
  // pago con ese nombre para no mezclarlo con el resto.
  let payId = null;
  function prepareCard(card) {
    const sel = $('#impPay');
    sel.textContent = '';
    for (const p of host.pays()) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = host.payName(p);
      sel.appendChild(o);
    }
    const proposed = card ? t('imp.cardName', { n: card }) : null;
    if (proposed) {
      const existing = host.pays().find((p) => p.name === proposed);
      if (existing) {
        payId = existing.id;
      } else {
        const o = document.createElement('option');
        o.value = '__new__';
        o.textContent = proposed;
        sel.insertBefore(o, sel.firstChild);
        payId = '__new__';
        sel.dataset.newName = proposed;
      }
    } else {
      payId = host.pays()[0].id;
    }
    sel.value = payId;
  }

  function foreign() {
    return parsed.filter((r) => r.currency !== host.currency());
  }

  function convert(row) {
    if (row.currency === host.currency()) return row.cents;
    if (!rate) return null;
    return Math.round(row.cents * rate);
  }

  function selected() {
    return parsed.filter((r) => r.on && convert(r) !== null);
  }

  function render() {
    const list = $('#impList');
    list.textContent = '';

    let currentCur = null;
    for (const row of parsed) {
      if (row.currency !== currentCur) {
        currentCur = row.currency;
        const head = document.createElement('div');
        head.className = 'imp-section';
        head.textContent = currentCur === host.currency()
          ? t('imp.section.own', { cur: currentCur })
          : t('imp.section.other', { cur: currentCur });
        list.appendChild(head);
      }

      // Sin tasa de cambio, un movimiento en otra moneda no se puede importar:
      // se muestra desmarcado aunque el usuario lo hubiera marcado antes.
      const usable = convert(row) !== null;
      const on = row.on && usable;

      const el = document.createElement('div');
      el.className = 'imp-row' + (on ? ' on' : '');
      el.innerHTML =
        '<button type="button" class="imp-check" aria-pressed="false"></button>' +
        '<div class="imp-main"><div class="imp-desc"></div><div class="imp-meta"></div></div>' +
        '<div class="imp-right"><div class="imp-amt"></div><select class="imp-cat"></select></div>';

      const check = el.querySelector('.imp-check');
      check.textContent = on ? '✓' : '';
      check.setAttribute('aria-pressed', String(on));
      check.onclick = () => {
        if (!usable) return host.toast(t('imp.needRate'));
        row.on = !row.on;
        render();
      };

      el.querySelector('.imp-desc').textContent = row.desc;

      const tags = [row.date.slice(8) + '/' + row.date.slice(5, 7)];
      if (row.credit) tags.push(t('imp.tag.payment'));
      if (row.dup) tags.push(t('imp.tag.dup'));
      el.querySelector('.imp-meta').textContent = tags.join('  ·  ');

      const converted = convert(row);
      el.querySelector('.imp-amt').textContent = converted === null
        ? row.currency + ' ' + (row.cents / 100).toFixed(2)
        : host.fmt(converted);

      const sel = el.querySelector('.imp-cat');
      for (const c of host.cats()) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = host.catName(c);
        sel.appendChild(o);
      }
      sel.value = row.cat;
      sel.onchange = () => { row.cat = sel.value; };

      list.appendChild(el);
    }

    const picked = selected();
    const total = picked.reduce((sum, r) => sum + convert(r), 0);
    $('#impSummary').textContent = t('imp.summary', {
      n: picked.length, total: host.fmt(total), all: parsed.length
    });
    $('#impSave').textContent = t('imp.add', { n: picked.length });
    $('#impRate').hidden = foreign().length === 0;
    if (foreign().length) {
      $('#impRateLabel').textContent = t('imp.rate', {
        from: foreign()[0].currency, to: host.currency()
      });
    }
  }

  function toggleAll() {
    const anyOff = parsed.some((r) => !r.on && convert(r) !== null);
    for (const r of parsed) r.on = anyOff && convert(r) !== null;
    render();
  }

  function close() {
    $('#impSheet').hidden = true;
    $('#impBackdrop').hidden = true;
    parsed = [];
  }

  function commit() {
    const picked = selected();
    if (!picked.length) return host.toast(t('imp.pickSome'));

    const sel = $('#impPay');
    let pay = sel.value;
    if (pay === '__new__') pay = host.addPay(sel.dataset.newName, '\u{1F4B3}');

    host.addImported(picked.map((r) => ({
      cents: convert(r), cat: r.cat, pay: pay, date: r.date,
      note: r.desc, sig: r.sig
    })), fileName);
    close();
  }

  /* ---------------- Enganches ---------------- */

  function init(bridge) {
    host = bridge;
    $('#impCancel').addEventListener('click', close);
    $('#impBackdrop').addEventListener('click', close);
    $('#impSave').addEventListener('click', commit);
    $('#impAll').addEventListener('click', toggleAll);
    $('#impPay').addEventListener('change', (ev) => { payId = ev.target.value; });
    $('#impRateInput').addEventListener('input', (ev) => {
      const n = parseFloat(ev.target.value.replace(',', '.'));
      rate = Number.isFinite(n) && n > 0 ? n : 0;
      for (const r of parsed) if (r.currency !== host.currency() && !rate) r.on = false;
      render();
    });
  }

  return { init: init, open: open };
})();
