/* Importador de estados de cuenta en PDF.

   Todo ocurre en el teléfono: el PDF se lee con pdf.js servido desde este
   mismo sitio (carpeta vendor/), nunca se sube a ningún servidor.

   Se pueden abrir varios estados de una vez para montar el historial de una
   tarjeta. Dos cuidados que eso obliga:
   - Estados consecutivos repiten movimientos del cambio de mes, así que la
     deduplicación mira también lo que ya trae la propia tanda.
   - Un mismo comercio puede cobrar dos veces el mismo día el mismo importe:
     son dos gastos reales, no un duplicado, y la firma lleva el número de
     repetición para distinguirlos. */
window.STATEMENT = (() => {
  'use strict';

  let host = null;          // puente con app.js
  let parsed = [];          // movimientos de todos los archivos abiertos
  let rate = 0;             // tasa de cambio para la moneda extranjera

  const $ = (s) => document.querySelector(s);
  const t = (k, v) => window.I18N.t(k, v);
  const tn = (k, n, v) => window.I18N.tn(k, n, v);

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
    const dec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    // Dos dígitos tras el último separador = parte decimal (da igual si el
    // banco escribe 10,275.09 o 10.275,09).
    if (dec >= 0 && s.length - dec - 1 === 2) {
      const int = s.slice(0, dec).replace(/[.,]/g, '');
      return Math.round(Number(int + '.' + s.slice(dec + 1)) * 100);
    }
    const n = Number(s.replace(/[.,]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }

  const isoDate = (m) => m[3] + '-' + m[2] + '-' + m[1];

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
            if (Number.isFinite(cents)) { amounts.push({ cents: cents, right: it.x + it.w }); continue; }
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
    const head = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    const m = head.match(/(\d{4})\s*[*x·•]{2,}\s*(\d{4})|[*x·•]{4,}\s*(\d{4})/i);
    if (m) card = m[2] || m[3];

    return { rows: rows, card: card };
  }

  /* ---------------- Categoría sugerida ---------------- */

  const RULES = [
    ['super',    /JUMBO|SIRENA|SUPERMERCAD|COOPCIBAO|PLAZA LAMA|BRAVO|NACIONAL|OLE|MERCADO|GROCER|WALMART|CARREFOUR|MERCADONA/],
    ['comida',   /BURGER|PIZZA|HELADO|RESTAUR|CAFE|COFFEE|MCDONALD|WENDY|KFC|DOMINO|SUBWAY|TERIYAKI|SUSHI|BON |BOMBAZO|PANADER|REPOSTER|DELI|BAR |TACO|FOOD/],
    ['transpor', /TEXACO|SHELL|ESSO|SUNIX|ESTACION|GASOLIN|COMBUSTIB|UBER|TAXI|AERODOM|AIRLIN|AVIANCA|PARQUEO|PEAJE|PASSPORT|TRANSPORT|METRO|CARIBE TOURS/],
    ['casa',     /EDENORTE|EDESUR|EDEESTE|CLARO|ALTICE|VIVA|TRICOM|CAASD|CORAA|INAPA|IKEA|FERRETER|CONDOMINIO|MUEBL|HOGAR|HOME|DEPOT/],
    ['salud',    /FARMACIA|CAROL|GBC|MEDIC|CLINIC|HOSPITAL|LABORATORI|DENTAL|OPTIC|SALUD|PHARMA/],
    ['ropa',     /TIENDA|ZARA|BOUTIQUE|SHOES|CALZADO|ROPA|MODA|FASHION|PAYLESS|ADIDAS|NIKE/],
    ['subs',     /NETFLIX|SPOTIFY|ANTHROPIC|OPENAI|CLAUDE|APPLE\.COM|ITUNES|GOOGLE|MICROSOFT|ADOBE|PRIME|DISNEY|HBO|YOUTUBE|DROPBOX|ICLOUD|SUBSCRIPTION|SUB /],
    ['banco',    /COMISION|INTERES|AVANCE|MORA|CARGO POR|SEGURO|AHORRO|IMPUESTO|ITBIS|CUOTA MANEJO|MANTENIMIENTO/]
  ];

  function suggestCat(desc) {
    const s = desc.toUpperCase();
    for (const [id, re] of RULES) {
      if (re.test(s) && host.hasCat(id)) return id;
    }
    return host.hasCat('otros') ? 'otros' : host.firstCat();
  }

  /* ---------------- Firmas ---------------- */

  const baseSig = (row) => row.date + '|' + row.cents + '|' + row.desc.slice(0, 24).toUpperCase();

  // La primera vez va sin sufijo, para seguir reconociendo lo importado antes
  // de que existiera el contador.
  const numbered = (base, n) => (n <= 1 ? base : base + '#' + n);

  /* ---------------- Abrir uno o varios PDF ---------------- */

  /* Lectura pura, sin interfaz: la usa esta pantalla y también la de
     conciliación. Devuelve los movimientos con su firma ya numerada por
     archivo y el dato de si vienen repetidos de otro archivo de la tanda. */
  async function parseFiles(fileList, onProgress) {
    const files = Array.from(fileList || []).filter(Boolean);
    const rows = [];
    const known = new Set();
    let card = null;
    let failed = 0;
    let read = 0;

    for (const file of files) {
      if (onProgress) onProgress(++read, files.length);

      let result;
      try {
        result = await readPdf(file);
      } catch (_) {
        failed++;
        continue;
      }
      if (result.card && !card) card = result.card;

      /* Repetir una firma significa cosas distintas según dónde pase:
         - dentro del mismo estado, el banco lista dos cobros que de verdad
           ocurrieron dos veces ese día, y hay que contar los dos;
         - entre dos estados, es el mismo movimiento apareciendo en ambos,
           porque los cortes de mes se solapan, y solo cuenta una vez. */
      const inThisFile = new Map();
      for (const row of result.rows) {
        const base = baseSig(row);
        const n = (inThisFile.get(base) || 0) + 1;
        inThisFile.set(base, n);
        const sig = numbered(base, n);
        rows.push({
          file: file.name || 'PDF',
          date: row.date,
          desc: row.desc,
          cents: row.cents,
          currency: row.currency || host.currency(),
          credit: Boolean(row.credit),
          sig: sig,
          repeated: known.has(sig)     // ya venía en un archivo anterior
        });
        known.add(sig);
      }
    }

    rows.sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc));
    return { rows: rows, card: card, failed: failed, files: files.length };
  }

  let cardSeen = null;

  async function open(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    parsed = [];
    rate = 0;
    cardSeen = null;

    const already = host.signatures();
    const result = await parseFiles(files, (n, total) => {
      host.toast(total > 1 ? t('imp.readingOne', { n: n, total: total }) : t('imp.reading'));
    });
    cardSeen = result.card;

    for (const row of result.rows) {
      // Ya apuntado en la app, o repetido por el solapamiento entre estados.
      const dup = already.has(row.sig) || row.repeated;
      parsed.push(Object.assign({}, row, {
        dup: dup,
        cat: suggestCat(row.desc),
        // Un pago a la tarjeta no es un gasto, y un duplicado ya está apuntado.
        on: !row.credit && !dup
      }));
    }

    if (!parsed.length) {
      return host.toast(t(result.failed ? 'imp.failed' : 'imp.nothing'));
    }
    if (result.failed) host.toast(tn('imp.someFailed', result.failed));

    prepareCard(cardSeen);
    buildList();
    refreshSummary();
    $('#impSheet').hidden = false;
    $('#impBackdrop').hidden = false;
    $('#impSheet').scrollTop = 0;
  }

  // Si el estado de cuenta trae los últimos dígitos, se propone una forma de
  // pago con ese nombre para no mezclarlo con el resto.
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
      const existing = host.pays().find((p) => host.payName(p) === proposed);
      if (existing) {
        sel.value = existing.id;
        return;
      }
      const o = document.createElement('option');
      o.value = '__new__';
      o.textContent = proposed;
      sel.insertBefore(o, sel.firstChild);
      sel.dataset.newName = proposed;
      sel.value = '__new__';
      return;
    }
    sel.value = host.pays()[0].id;
  }

  /* ---------------- Interfaz de revisión ---------------- */

  const convert = (row) => {
    if (row.currency === host.currency()) return row.cents;
    return rate ? Math.round(row.cents * rate) : null;
  };

  const usable = (row) => convert(row) !== null;
  const selected = () => parsed.filter((r) => r.on && usable(r));

  /* Con doce estados de cuenta esto son cientos de filas: se construyen una
     sola vez y cada toque repinta solo su fila, no la lista entera. */
  function buildList() {
    const list = $('#impList');
    list.textContent = '';

    let currentMonth = null;
    for (const row of parsed) {
      const month = row.date.slice(0, 7);
      if (month !== currentMonth) {
        currentMonth = month;
        const head = document.createElement('div');
        head.className = 'imp-section';
        head.textContent = host.monthLabel(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
        list.appendChild(head);
      }
      list.appendChild(buildRow(row));
    }
  }

  function buildRow(row) {
    const el = document.createElement('div');
    el.className = 'imp-row';
    el.innerHTML =
      '<button type="button" class="imp-check"></button>' +
      '<div class="imp-main"><div class="imp-desc"></div><div class="imp-meta"></div></div>' +
      '<div class="imp-right"><div class="imp-amt"></div><select class="imp-cat"></select></div>';

    el.querySelector('.imp-desc').textContent = row.desc;

    const tags = [row.date.slice(8) + '/' + row.date.slice(5, 7)];
    if (row.currency !== host.currency()) tags.push(row.currency);
    if (row.credit) tags.push(t('imp.tag.payment'));
    if (row.dup) tags.push(t('imp.tag.dup'));
    el.querySelector('.imp-meta').textContent = tags.join('  ·  ');

    const check = el.querySelector('.imp-check');
    check.onclick = () => {
      if (!usable(row)) return host.toast(t('imp.needRate'));
      row.on = !row.on;
      paintRow(el, row);
      refreshSummary();
    };

    // Las categorías se cuelgan al abrir el desplegable: con cientos de filas,
    // crearlas todas de golpe hace lenta la pantalla en el teléfono.
    const sel = el.querySelector('.imp-cat');
    const fill = () => {
      if (sel.options.length) return;
      for (const c of host.cats()) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = host.catName(c);
        sel.appendChild(o);
      }
      sel.value = row.cat;
    };
    sel.addEventListener('focus', fill);
    sel.addEventListener('mousedown', fill);
    sel.addEventListener('touchstart', fill, { passive: true });
    sel.onchange = () => { row.cat = sel.value; };

    paintRow(el, row);
    return el;
  }

  function paintRow(el, row) {
    const on = row.on && usable(row);
    el.classList.toggle('on', on);
    const check = el.querySelector('.imp-check');
    check.textContent = on ? '✓' : '';
    check.setAttribute('aria-pressed', String(on));

    const cents = convert(row);
    el.querySelector('.imp-amt').textContent = cents === null
      ? (row.cents / 100).toFixed(2)
      : host.fmt(cents);

    const sel = el.querySelector('.imp-cat');
    if (sel.options.length) sel.value = row.cat;
    else sel.innerHTML = '<option>' + host.catName(host.catById(row.cat)) + '</option>';
  }

  function repaintAll() {
    const rows = $('#impList').querySelectorAll('.imp-row');
    let i = 0;
    for (const row of parsed) paintRow(rows[i++], row);
  }

  function refreshSummary() {
    const picked = selected();
    const total = picked.reduce((s, r) => s + convert(r), 0);
    $('#impSummary').textContent = t('imp.summary', {
      n: picked.length, total: host.fmt(total), all: parsed.length
    });
    $('#impSave').textContent = t('imp.add', { n: picked.length });

    const foreign = parsed.some((r) => r.currency !== host.currency());
    $('#impRate').hidden = !foreign;
    if (foreign) {
      const other = parsed.find((r) => r.currency !== host.currency());
      $('#impRateLabel').textContent = t('imp.rate', { from: other.currency, to: host.currency() });
    }
  }

  /* "Marcar todo" no marca literalmente todo: con doce estados solapados eso
     metería los duplicados y los pagos a la tarjeta. Marca lo que la app
     recomienda, y si ya está todo marcado, lo quita. */
  function toggleAll() {
    const recommended = (r) => usable(r) && !r.dup && !r.credit;
    const missing = parsed.some((r) => !r.on && recommended(r));
    for (const r of parsed) r.on = missing && recommended(r);
    repaintAll();
    refreshSummary();
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
      note: r.desc, sig: r.sig, file: r.file
    })));
    close();
  }

  /* ---------------- Enganches ---------------- */

  function init(bridge) {
    host = bridge;
    $('#impCancel').addEventListener('click', close);
    $('#impBackdrop').addEventListener('click', close);
    $('#impSave').addEventListener('click', commit);
    $('#impAll').addEventListener('click', toggleAll);
    $('#impRateInput').addEventListener('input', (ev) => {
      const n = host.parseNumber(ev.target.value);
      rate = n > 0 ? n : 0;
      repaintAll();
      refreshSummary();
    });
  }

  return { init: init, open: open, parseFiles: parseFiles, suggestCat: suggestCat };
})();
