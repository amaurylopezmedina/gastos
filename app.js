/* Gastos — PWA local. Todo el dinero se guarda en céntimos (enteros) para
   evitar los errores de redondeo de los flotantes. Los gastos viven en
   localStorage; las fotos de facturas, en IndexedDB (son demasiado grandes
   para localStorage). Los textos salen de i18n.js. */
(() => {
  'use strict';

  const KEY = 'gastos.v1';
  const t = (k, v) => window.I18N.t(k, v);
  const tn = (k, n, v) => window.I18N.tn(k, n, v);

  /* Las entradas por defecto no guardan el nombre: se traduce en cada idioma
     (std: true). Las que crea el usuario guardan su propio nombre. */
  const DEFAULT_CATS = [
    { id: 'comida',   icon: '\u{1F37D}\u{FE0F}', std: true },
    { id: 'super',    icon: '\u{1F6D2}',         std: true },
    { id: 'transpor', icon: '\u{1F687}',         std: true },
    { id: 'casa',     icon: '\u{1F3E0}',         std: true },
    { id: 'ocio',     icon: '\u{1F37B}',         std: true },
    { id: 'salud',    icon: '\u{1F48A}',         std: true },
    { id: 'ropa',     icon: '\u{1F455}',         std: true },
    { id: 'subs',     icon: '\u{1F4F1}',         std: true },
    { id: 'banco',    icon: '\u{1F3E6}',         std: true },
    { id: 'otros',    icon: '\u{2728}',          std: true }
  ];

  const DEFAULT_PAYS = [
    { id: 'efectivo', icon: '\u{1F4B5}', std: true },
    { id: 'tarjeta',  icon: '\u{1F4B3}', std: true },
    { id: 'transfer', icon: '\u{1F3E6}', std: true }
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------------- Estado ---------------- */

  let state = load();
  let syncReady = false;                   // true cuando SYNC.init ya corrió
  let cursor = startOfMonth(new Date());   // mes visible
  let draft = null;                        // gasto en edición dentro de la hoja
  let draftPhotoUrl = null;                // objectURL de la foto mostrada en la hoja

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
    const base = {
      v: 3, lang: null, currency: 'EUR', budget: 0,
      cats: DEFAULT_CATS.slice(), pays: DEFAULT_PAYS.slice(),
      expenses: [], debts: [], imports: [], budgetLines: {}
    };
    if (!saved || typeof saved !== 'object') return base;

    // Las categorías estándar que se añaden en versiones nuevas (p. ej. Banco)
    // tienen que aparecer también en los datos ya guardados.
    const cats = Array.isArray(saved.cats) && saved.cats.length ? saved.cats.slice() : base.cats;
    for (const def of DEFAULT_CATS) {
      if (!cats.some((c) => c.id === def.id)) cats.push(def);
    }

    return {
      v: 3,
      debts: Array.isArray(saved.debts) ? saved.debts : [],
      imports: Array.isArray(saved.imports) ? saved.imports : [],
      budgetLines: saved.budgetLines && typeof saved.budgetLines === 'object' && !Array.isArray(saved.budgetLines) ? saved.budgetLines : {},
      lang: typeof saved.lang === 'string' ? saved.lang : null,
      currency: typeof saved.currency === 'string' ? saved.currency : base.currency,
      budget: Number.isFinite(saved.budget) ? saved.budget : 0,
      cats: cats,
      pays: Array.isArray(saved.pays) && saved.pays.length ? saved.pays : base.pays,
      expenses: Array.isArray(saved.expenses) ? saved.expenses.filter(validExpense) : []
    };
  }

  function validDebt(d) {
    return d && typeof d === 'object' && typeof d.name === 'string' && d.name.trim()
      && Number.isFinite(d.balance) && d.balance >= 0
      && Number.isFinite(d.payment) && d.payment > 0;
  }

  function validExpense(e) {
    return e && typeof e.id === 'string' && Number.isFinite(e.cents)
      && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      toast(t('msg.full'));
    }
    if (syncReady) window.SYNC.changed();
  }

  /* ---------------- Fotos (IndexedDB) ---------------- */

  const DB_NAME = 'gastos-fotos';
  const STORE = 'photos';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function photoOp(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.onerror = () => reject(tx.error);
      if (req) req.onsuccess = () => resolve(req.result);
      else tx.oncomplete = () => resolve();
    }));
  }

  // IndexedDB es la copia local; la verdad está en el servidor (sync.js).
  const photoLocalGet = (id) => photoOp('readonly', (s) => s.get(id));
  const photoLocalPut = (id, blob) => photoOp('readwrite', (s) => s.put(blob, id));
  const photoLocalDel = (id) => photoOp('readwrite', (s) => s.delete(id));
  const photoLocalKeys = () => photoOp('readonly', (s) => s.getAllKeys());

  async function photoGet(id) {
    let blob = await photoLocalGet(id).catch(() => null);
    if (blob) return blob;
    blob = await window.SYNC.photoDown(id);
    if (blob) await photoLocalPut(id, blob).catch(() => {});
    return blob;
  }
  async function photoPut(id, blob) {
    await photoLocalPut(id, blob);
    await window.SYNC.photoPut(id, blob);     // si no hay red queda pendiente y se sube luego
  }
  async function photoDel(id) {
    await photoLocalDel(id).catch(() => {});
    await window.SYNC.photoDelete(id);
  }
  async function photoKeys() {
    const local = await photoLocalKeys().catch(() => []);
    const remote = await window.SYNC.photoIds();
    return Array.from(new Set(local.concat(remote)));
  }

  /* Las fotos del iPhone pesan varios MB: se reescalan y recomprimen antes
     de guardarlas, o el almacén se llena enseguida. */
  async function shrink(file, maxPx = 1600, quality = 0.72) {
    let width, height, source;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      width = bmp.width; height = bmp.height; source = bmp;
    } catch (_) {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
      width = source.naturalWidth; height = source.naturalHeight;
    }

    const scale = Math.min(1, maxPx / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(source, 0, 0, w, h);
    if (source.close) source.close();

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob || file;   // si toBlob falla, guarda el original
  }

  /* ---------------- Fechas y formatos ---------------- */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Todos los formateadores dependen del idioma: se rehacen al cambiarlo.
  let money, moneyShort, plain, monthFmt, monthShortFmt, dayFmt, decimalSep;

  /* Cada moneda se escribe distinto en su país: en República Dominicana es
     "RD$10,275.09" y no "10.275,09 DOP", que es lo que saldría con es-ES. */
  const CURRENCY_LOCALE = {
    DOP: 'es-DO', MXN: 'es-MX', COP: 'es-CO', ARS: 'es-AR',
    CLP: 'es-CL', PEN: 'es-PE', EUR: 'es-ES', USD: 'en-US', GBP: 'en-GB'
  };

  function moneyLocale() {
    const regional = CURRENCY_LOCALE[state.currency];
    const lang = window.I18N.current();
    // Solo se adopta el locale del país si habla el idioma elegido; si no,
    // manda el idioma de la app.
    return regional && regional.slice(0, 2) === lang ? regional : window.I18N.locale();
  }

  function buildFormatters() {
    const loc = moneyLocale();
    money = new Intl.NumberFormat(loc, { style: 'currency', currency: state.currency });
    moneyShort = new Intl.NumberFormat(loc, {
      style: 'currency', currency: state.currency,
      minimumFractionDigits: 0, maximumFractionDigits: 0
    });
    plain = new Intl.NumberFormat(loc);
    monthFmt = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' });
    monthShortFmt = new Intl.DateTimeFormat(loc, { month: 'short' });
    dayFmt = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' });

    const part = plain.formatToParts(1.5).find((p) => p.type === 'decimal');
    decimalSep = part ? part.value : ',';
    $('#decimalKey').textContent = decimalSep;
  }

  const fmt = (cents) => money.format(cents / 100);
  const fmtShort = (cents) => moneyShort.format(cents / 100);

  function currencySymbol() {
    const part = money.formatToParts(0).find((p) => p.type === 'currency');
    return part ? part.value : state.currency;
  }

  // Intl devuelve los meses/días en minúscula en varios idiomas: sube solo la
  // inicial (text-transform: capitalize daría "Septiembre De 2026").
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function dayLabel(dateStr) {
    const today = ymd(new Date());
    const yest = ymd(new Date(Date.now() - 864e5));
    if (dateStr === today) return t('day.today');
    if (dateStr === yest) return t('day.yesterday');
    return cap(dayFmt.format(parseDate(dateStr)));
  }

  /* ---------------- Categorías y formas de pago ---------------- */

  // Las estándar toman su nombre del idioma activo; las del usuario, el suyo.
  const label = (item, prefix) => (item.std ? t(prefix + '.' + item.id) : item.name);

  const catById = (id) => state.cats.find((c) => c.id === id) || null;
  const payById = (id) => state.pays.find((p) => p.id === id) || null;

  const payLabel = (id) => { const p = payById(id); return p ? label(p, 'pay') : '?'; };
  const catName = (id) => {
    const c = catById(id);
    return c ? label(c, 'cat') : t('cat.none');
  };

  function entriesOfMonth(d) {
    const k = monthKey(d);
    return state.expenses.filter((e) => e.date.slice(0, 7) === k);
  }
  const isIncome = (e) => e.kind === 'income';
  const isTransfer = (e) => e.kind === 'transfer';   // mover dinero entre tus cuentas: ni gasto ni ingreso
  const isSpend = (e) => !isIncome(e) && !isTransfer(e);
  // «Gastos» no incluye los ingresos: así ningún total del mes los mezcla.
  const expensesOfMonth = (d) => entriesOfMonth(d).filter(isSpend);
  const sum = (list) => list.reduce((total, e) => total + e.cents, 0);

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function haptic() {
    if (navigator.vibrate) navigator.vibrate(8);
  }

  /* ---------------- Render: lista ---------------- */

  function renderList() {
    const all = entriesOfMonth(cursor);
    const mine = expensesOfMonth(cursor);
    const total = sum(mine);

    const monthLabel = cap(monthFmt.format(cursor));
    $('#monthName').textContent = monthLabel;
    $('#monthName2').textContent = monthLabel;
    $('#monthSub').textContent = all.length ? tn('list.count', all.length) : '';
    $('#monthTotal').textContent = fmt(total);

    // Presupuesto
    const wrap = $('#budgetWrap');
    if (state.budget > 0) {
      wrap.hidden = false;
      const pct = Math.min(100, Math.round((total / state.budget) * 100));
      const fill = $('#budgetFill');
      fill.style.width = pct + '%';
      fill.className = 'budget-fill' + (total > state.budget ? ' over' : pct >= 80 ? ' warn' : '');
      const left = state.budget - total;
      $('#budgetText').textContent = left >= 0
        ? t('budget.left', { left: fmt(left), total: fmt(state.budget) })
        : t('budget.over', { over: fmt(-left) });
    } else {
      wrap.hidden = true;
    }

    // Agrupado por día, más reciente primero
    const byDay = new Map();
    for (const e of all) {
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date).push(e);
    }
    const days = Array.from(byDay.keys()).sort().reverse();

    const body = $('#listBody');
    body.textContent = '';
    $('#listEmpty').hidden = all.length > 0;

    for (const day of days) {
      const items = byDay.get(day).sort((a, b) => (b.ts || 0) - (a.ts || 0));

      const head = document.createElement('div');
      head.className = 'day-head';
      head.innerHTML = '<span></span><b></b>';
      head.firstChild.textContent = dayLabel(day);
      head.lastChild.textContent = fmt(sum(items.filter(isSpend)));
      body.appendChild(head);

      const group = document.createElement('div');
      group.className = 'day-group';
      for (const e of items) {
        const cat = catById(e.cat);
        const pay = payById(e.pay);
        const row = document.createElement('button');
        row.className = 'item';
        row.dataset.id = e.id;
        row.innerHTML =
          '<span class="item-ico"></span>' +
          '<span class="item-main"><span class="item-cat"></span><span class="item-note"></span></span>' +
          '<span class="item-amount"></span>';
        row.querySelector('.item-ico').textContent = isTransfer(e) ? '\u{1F501}' : isIncome(e) ? '\u{1F4B0}' : (cat ? cat.icon : '\u{2753}');
        row.querySelector('.item-cat').textContent = isTransfer(e)
          ? t('kind.transfer') + ': ' + payLabel(e.pay) + ' \u2192 ' + payLabel(e.to)
          : e.rubro && window.RUBROS.get(e.rubro) ? window.RUBROS.name(e.rubro) : catName(e.cat);

        // Subtítulo: nota + forma de pago + clip si hay foto adjunta.
        const bits = [];
        if (e.note) bits.push(e.note);
        if (pay && !isTransfer(e)) bits.push(pay.icon + ' ' + label(pay, 'pay'));
        if (e.photo) bits.push('\u{1F4CE}');
        const note = row.querySelector('.item-note');
        if (bits.length) note.textContent = bits.join('  ·  '); else note.remove();

        const amount = row.querySelector('.item-amount');
        amount.textContent = (isIncome(e) ? '+' : '') + fmt(e.cents);
        if (isIncome(e)) amount.classList.add('income');
        if (isTransfer(e)) amount.classList.add('transfer');
        group.appendChild(row);
      }
      body.appendChild(group);
    }
  }

  /* ---------------- Render: resumen ---------------- */

  function breakdown(box, entries, total, lookup) {
    box.textContent = '';
    box.hidden = entries.length === 0;
    for (const [id, cents] of entries) {
      const item = lookup(id);
      const pct = Math.round((cents / total) * 100);
      const row = document.createElement('div');
      row.className = 'bd-row';
      row.innerHTML =
        '<div class="bd-top"><span class="e"></span><span class="nm"></span>' +
        '<span class="pct"></span><span class="amt"></span></div>' +
        '<div class="bd-bar"><i></i></div>';
      row.querySelector('.e').textContent = item.icon;
      row.querySelector('.nm').textContent = item.name;
      row.querySelector('.pct').textContent = pct + '%';
      row.querySelector('.amt').textContent = fmt(cents);
      row.querySelector('.bd-bar i').style.width = Math.max(pct, 2) + '%';
      box.appendChild(row);
    }
  }

  function renderStats() {
    const mine = expensesOfMonth(cursor);
    const total = sum(mine);
    const prev = sum(expensesOfMonth(addMonths(cursor, -1)));

    // Media diaria: en el mes en curso se divide por los días transcurridos.
    const now = new Date();
    const isCurrent = monthKey(now) === monthKey(cursor);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const days = isCurrent ? now.getDate() : daysInMonth;

    $('#stTotal').textContent = fmt(total);
    $('#stAvg').textContent = fmt(Math.round(total / days));
    $('#stCount').textContent = plain.format(mine.length);

    const delta = $('#stDelta');
    if (prev === 0) {
      delta.textContent = total === 0 ? '—' : t('stats.nodata');
      delta.className = 'card-value';
    } else {
      const pct = Math.round(((total - prev) / prev) * 100);
      delta.textContent = (pct > 0 ? '+' : '') + pct + '%';
      delta.className = 'card-value ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : '');
    }

    const byCat = new Map();
    const byPay = new Map();
    for (const e of mine) {
      byCat.set(e.cat, (byCat.get(e.cat) || 0) + e.cents);
      byPay.set(e.pay || '__none__', (byPay.get(e.pay || '__none__') || 0) + e.cents);
    }
    const desc = (a, b) => b[1] - a[1];

    breakdown($('#catBreakdown'), Array.from(byCat.entries()).sort(desc), total, (id) => {
      const c = catById(id);
      return { icon: c ? c.icon : '\u{2753}', name: catName(id) };
    });
    breakdown($('#payBreakdown'), Array.from(byPay.entries()).sort(desc), total, (id) => {
      const p = payById(id);
      return { icon: p ? p.icon : '\u{2753}', name: p ? label(p, 'pay') : t('pay.none') };
    });
    $('#statsEmpty').hidden = mine.length > 0;

    // Últimos 6 meses
    const chart = $('#chart');
    chart.textContent = '';
    const series = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(cursor, -i);
      series.push({ d: m, total: sum(expensesOfMonth(m)) });
    }
    const max = Math.max(1, ...series.map((s) => s.total));
    for (const s of series) {
      const bar = document.createElement('div');
      bar.className = 'bar' + (monthKey(s.d) === monthKey(cursor) ? ' now' : '');
      bar.innerHTML = '<em></em><i></i><span></span>';
      bar.querySelector('em').textContent = s.total ? fmtShort(s.total) : '';
      bar.querySelector('i').style.height = Math.round((s.total / max) * 100) + '%';
      bar.querySelector('span').textContent = monthShortFmt.format(s.d).replace('.', '');
      chart.appendChild(bar);
    }
  }

  /* ---------------- Render: ajustes ---------------- */

  function renderChipEditor(box, list, kind) {
    const prefix = kind === 'cat' ? 'cat' : 'pay';
    box.textContent = '';
    for (const item of list) {
      const used = state.expenses.filter((e) => (kind === 'cat' ? e.cat : e.pay) === item.id).length;
      const line = document.createElement('div');
      line.className = 'cat-line';
      line.innerHTML =
        '<span class="ico"></span><span class="nm"></span>' +
        '<span class="used"></span><button class="rm" type="button"></button>';
      line.querySelector('.ico').textContent = item.icon;
      line.querySelector('.nm').textContent = label(item, prefix);
      line.querySelector('.used').textContent = used ? tn('set.used', used) : '';
      const rm = line.querySelector('.rm');
      rm.textContent = t('set.remove');
      rm.onclick = () => removeItem(kind, item.id, used);
      box.appendChild(line);
    }
  }

  function removeItem(kind, id, used) {
    const list = kind === 'cat' ? state.cats : state.pays;
    if (list.length <= 1) return toast(t('msg.keepOne'));
    const key = kind === 'cat' ? 'Cat' : 'Pay';
    const msg = used ? t('ask.remove' + key + 'Used', { n: used }) : t('ask.remove' + key);
    if (!confirm(msg)) return;
    if (kind === 'cat') state.cats = state.cats.filter((c) => c.id !== id);
    else state.pays = state.pays.filter((p) => p.id !== id);
    save();
    renderAll();
  }

  /* Cada importación se puede deshacer entera. Se cuenta lo que queda de
     verdad, porque el usuario puede haber borrado o editado gastos sueltos
     desde entonces. */
  function renderImports() {
    const box = $('#importList');
    box.textContent = '';
    $('#importsTitle').hidden = state.imports.length === 0;
    box.hidden = state.imports.length === 0;

    for (const batch of state.imports.slice().reverse()) {
      const alive = state.expenses.filter((e) => e.batch === batch.id);
      const line = document.createElement('div');
      line.className = 'cat-line';
      line.innerHTML =
        '<span class="nm"><b></b><small></small></span><button class="rm" type="button"></button>';
      line.querySelector('b').textContent = batch.file;
      line.querySelector('small').textContent = t('imp.batchInfo', {
        n: alive.length, total: fmt(sum(alive)), date: batch.when
      });
      const rm = line.querySelector('.rm');
      rm.textContent = t('set.remove');
      rm.onclick = () => removeBatch(batch, alive);
      box.appendChild(line);
    }
  }

  function removeBatch(batch, alive) {
    const msg = alive.length
      ? t('ask.removeBatch', { n: alive.length, total: fmt(sum(alive)), file: batch.file })
      : t('ask.removeBatchEmpty', { file: batch.file });
    if (!confirm(msg)) return;

    state.expenses = state.expenses.filter((e) => e.batch !== batch.id);
    state.imports = state.imports.filter((b) => b.id !== batch.id);
    save();
    renderAll();
    toast(tn('imp.batchRemoved', alive.length));
  }

  function renderSettings() {
    const sel = $('#lang');
    if (!sel.options.length) {
      for (const l of window.I18N.langs()) {
        const opt = document.createElement('option');
        opt.value = l.code;
        opt.textContent = l.name;
        sel.appendChild(opt);
      }
    }
    sel.value = window.I18N.current();
    $('#currency').value = state.currency;
    $('#budget').value = state.budget > 0
      ? (state.budget / 100).toFixed(2).replace('.', decimalSep)
      : '';
    renderChipEditor($('#catEditor'), state.cats, 'cat');
    renderChipEditor($('#payEditor'), state.pays, 'pay');
    renderImports();
    refreshUsage();
    showVersion();
  }

  /* La versión que de verdad está corriendo, para poder comprobar de un
     vistazo si el teléfono ya cogió la última. */
  function showVersion() {
    const note = $('#versionNote');
    if (!note || !window.caches) return;
    caches.keys().then((keys) => {
      const mine = keys.find((k) => k.indexOf('gastos-v') === 0);
      note.textContent = 'Gastos · ' + (mine ? mine.replace('gastos-', '') : '—');
    }).catch(() => {});
  }

  function refreshUsage() {
    const withPhoto = state.expenses.filter((e) => e.photo).length;
    const parts = [tn('set.usage.count', state.expenses.length), t('set.usage.photos', { n: withPhoto })];
    const note = $('#usageNote');
    note.textContent = parts.join(' · ');
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        if (!est || !est.usage) return;
        note.textContent = parts.concat(t('set.usage.size', { mb: (est.usage / 1048576).toFixed(1) })).join(' · ');
      }).catch(() => {});
    }
  }

  function renderAll() {
    buildFormatters();
    renderList();
    renderStats();
    renderSettings();
    if (window.LOANS) window.LOANS.render();
    if (window.PRESUPUESTO) window.PRESUPUESTO.render();
    if (window.CUENTAS) window.CUENTAS.render();
    if (window.BOLSILLO) window.BOLSILLO.render();
  }

  /* ---------------- Hoja: añadir / editar ---------------- */

  function releasePhotoUrl() {
    if (draftPhotoUrl) {
      URL.revokeObjectURL(draftPhotoUrl);
      draftPhotoUrl = null;
    }
  }

  function openSheet(expense, pendingPhoto, preset) {
    draft = expense
      ? {
          id: expense.id,
          raw: (expense.cents / 100).toFixed(2),
          cat: expense.cat,
          kind: expense.kind === 'income' ? 'income' : expense.kind === 'transfer' ? 'transfer' : 'expense',
          to: expense.to || null,
          rubro: expense.rubro || null,
          pay: expense.pay || state.pays[0].id,
          date: expense.date,
          note: expense.note || '',
          photo: expense.photo || null,
          newPhoto: null,
          dropPhoto: false
        }
      : {
          id: null, raw: '', cat: state.cats[0].id, kind: 'expense', to: null, rubro: null, pay: state.pays[0].id,
          date: ymd(new Date()), note: '', photo: null,
          newPhoto: pendingPhoto || null, dropPhoto: false
        };

    if (!expense && preset) Object.assign(draft, preset);   // p. ej. una transferencia ya preparada desde el bolsillo
    $('#sheetTitle').textContent = t(expense ? 'sheet.edit' : 'sheet.new');
    $('#deleteBtn').hidden = !expense;
    $('#amountCur').textContent = currencySymbol();
    $('#dateInput').value = draft.date;
    $('#noteInput').value = draft.note;

    renderPickers();
    paintAmount();
    paintPhoto();

    $('#backdrop').hidden = false;
    $('#sheet').hidden = false;
    $('#sheet').scrollTop = 0;
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    $('#backdrop').hidden = true;
    releasePhotoUrl();
    draft = null;
  }

  function chip(item, prefix, selected, onPick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cat-chip' + (selected ? ' on' : '');
    el.innerHTML = '<span class="e"></span><span class="n"></span>';
    el.querySelector('.e').textContent = item.icon;
    el.querySelector('.n').textContent = label(item, prefix);
    el.onclick = () => { haptic(); onPick(); };
    return el;
  }

  // Gasto / ingreso y rubro del presupuesto. El rubro fija la categoría de siempre.
  function renderKindRubro() {
    const income = draft.kind === 'income';
    const transfer = draft.kind === 'transfer';
    $('#kindExpense').classList.toggle('on', !income && !transfer);
    $('#kindIncome').classList.toggle('on', income);
    $('#kindTransfer').classList.toggle('on', transfer);
    $('#catPicker').hidden = income || transfer;
    $('#catLabel').hidden = income || transfer;
    $('#rubroSelect').hidden = transfer;           // una transferencia no es presupuesto
    $('#rubroLabel').hidden = transfer;
    $('#toLabel').hidden = !transfer;
    $('#toPicker').hidden = !transfer;
    const sel = $('#rubroSelect');
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('rubro.none');
    sel.appendChild(none);
    for (const g of window.RUBROS.groups) {
      if (Boolean(g.income) !== income) continue;
      const og = document.createElement('optgroup');
      og.label = g.icon + ' ' + window.RUBROS.groupName(g.id);
      for (const r of window.RUBROS.ofGroup(g.id)) {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = window.RUBROS.name(r.id);
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.value = draft.rubro && Array.from(sel.options).some((o) => o.value === draft.rubro) ? draft.rubro : '';
  }

  function renderPickers() {
    renderKindRubro();
    const cats = $('#catPicker');
    cats.textContent = '';
    for (const c of state.cats) {
      cats.appendChild(chip(c, 'cat', c.id === draft.cat, () => { draft.cat = c.id; renderPickers(); }));
    }
    const pays = $('#payPicker');
    pays.textContent = '';
    // Un ingreso entra a una cuenta (o en efectivo): no a una tarjeta. Una transferencia va entre cuentas.
    const accts = state.pays.filter((p) => p.kind === 'account' || p.id === 'efectivo');
    const accountsOnly = (draft.kind === 'income' || draft.kind === 'transfer') && accts.some((p) => p.kind === 'account');
    const choices = accountsOnly ? accts : state.pays;
    if (accountsOnly && !choices.some((p) => p.id === draft.pay)) draft.pay = choices[0].id;
    $('#payLabel').textContent = t(draft.kind === 'income' ? 'sheet.payIn' : draft.kind === 'transfer' ? 'sheet.payFrom' : 'sheet.pay');
    for (const p of choices) {
      pays.appendChild(chip(p, 'pay', p.id === draft.pay, () => { draft.pay = p.id; renderPickers(); }));
    }
    const dest = $('#toPicker');
    dest.textContent = '';
    if (draft.kind === 'transfer') {
      const targets = choices.filter((p) => p.id !== draft.pay);
      // Si el destino no vale, propone una cuenta bancaria antes que el efectivo.
      if (!targets.some((p) => p.id === draft.to)) {
        const best = targets.find((p) => p.kind === 'account') || targets[0];
        draft.to = best ? best.id : null;
      }
      for (const p of targets) {
        dest.appendChild(chip(p, 'pay', p.id === draft.to, () => { draft.to = p.id; renderPickers(); }));
      }
    }
    for (const box of [cats, pays, dest]) {
      const on = box.querySelector('.cat-chip.on');
      if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function paintAmount() {
    const raw = draft.raw;
    let shown;
    if (raw === '') {
      shown = '0';
    } else {
      const [int, dec] = raw.split('.');
      const intShown = plain.format(Number(int || 0));
      shown = dec === undefined ? intShown : intShown + decimalSep + dec;
    }
    $('#amountVal').textContent = shown;
  }

  function paintPhoto() {
    releasePhotoUrl();
    const thumb = $('#photoThumb');
    const add = $('#attachPhoto');

    const show = (blob) => {
      draftPhotoUrl = URL.createObjectURL(blob);
      $('#photoImg').src = draftPhotoUrl;
      thumb.hidden = false;
      add.innerHTML = '<span>\u{1F504}</span> ';
      add.appendChild(document.createTextNode(t('photo.change')));
    };

    if (draft.newPhoto) return show(draft.newPhoto);

    if (draft.photo && !draft.dropPhoto) {
      const wanted = draft.photo;
      photoGet(wanted).then((blob) => {
        // La hoja puede haberse cerrado o cambiado de gasto mientras se leía.
        if (blob && draft && draft.photo === wanted && !draft.dropPhoto) show(blob);
      }).catch(() => {});
      return;
    }

    thumb.hidden = true;
    $('#photoImg').removeAttribute('src');
    add.innerHTML = '<span>\u{1F4F7}</span> ';
    add.appendChild(document.createTextNode(t('photo.add')));
  }

  function press(k) {
    haptic();
    if (k === 'del') {
      draft.raw = draft.raw.slice(0, -1);
    } else if (k === '.') {
      if (!draft.raw.includes('.')) draft.raw = (draft.raw || '0') + '.';
    } else {
      const [int, dec] = draft.raw.split('.');
      if (dec !== undefined && dec.length >= 2) return;                  // máx. 2 decimales
      if (dec === undefined && int.replace('-', '').length >= 7) return; // tope razonable
      if (draft.raw === '0') draft.raw = k; else draft.raw += k;
    }
    paintAmount();
  }

  async function saveDraft() {
    const cents = Math.round(parseFloat(draft.raw || '0') * 100);
    if (!Number.isFinite(cents) || cents <= 0) return toast(t('msg.needAmount'));

    const date = $('#dateInput').value || ymd(new Date());
    const note = $('#noteInput').value.trim();
    const isEdit = Boolean(draft.id);

    // Resuelve la foto antes de tocar el estado.
    let photoId = draft.dropPhoto ? null : draft.photo;
    if (draft.newPhoto) {
      if (draft.photo) await photoDel(draft.photo).catch(() => {});
      photoId = 'ph_' + uid();
      try {
        await photoPut(photoId, draft.newPhoto);
      } catch (_) {
        photoId = null;
        toast(t('msg.photoSaveFail'));
      }
    } else if (draft.dropPhoto && draft.photo) {
      await photoDel(draft.photo).catch(() => {});
    }

    const income = draft.kind === 'income';
    const transfer = draft.kind === 'transfer';
    if (transfer && (!draft.to || draft.to === draft.pay)) return toast(t('msg.needTwoAccounts'));
    const cat = income || transfer ? (state.cats.some((c) => c.id === 'otros') ? 'otros' : state.cats[0].id) : draft.cat;
    const extra = {
      kind: income ? 'income' : transfer ? 'transfer' : undefined,
      to: transfer ? draft.to : undefined,
      rubro: transfer ? undefined : (draft.rubro || undefined)
    };
    if (isEdit) {
      const e = state.expenses.find((x) => x.id === draft.id);
      if (e) Object.assign(e, { cents, cat, pay: draft.pay, date, note, photo: photoId }, extra);
    } else {
      state.expenses.push(Object.assign({
        id: uid(), cents, cat, pay: draft.pay, date, note, photo: photoId, ts: Date.now()
      }, extra));
    }
    save();
    // Salta al mes del gasto para que siempre quede a la vista.
    cursor = startOfMonth(parseDate(date));
    closeSheet();
    renderAll();
    toast(t(isEdit ? 'msg.saved' : 'msg.added'));
  }

  async function deleteDraft() {
    if (!draft || !draft.id) return;
    if (!confirm(t('ask.deleteExpense'))) return;
    const gone = state.expenses.find((e) => e.id === draft.id);
    if (gone && gone.photo) await photoDel(gone.photo).catch(() => {});
    state.expenses = state.expenses.filter((e) => e.id !== draft.id);
    save();
    closeSheet();
    renderAll();
    toast(t('msg.deleted'));
  }

  /* ---------------- Cámara ---------------- */

  // El input file con accept="image/*" abre en iOS el menú Cámara / Fototeca.
  let photoTarget = 'sheet';   // 'sheet' = adjuntar al borrador abierto; 'new' = crear gasto

  function pickPhoto(target) {
    photoTarget = target;
    $('#photoFile').click();
  }

  async function onPhotoPicked(file) {
    if (!file) return;
    toast(t('msg.photoWorking'));
    let blob;
    try {
      blob = await shrink(file);
    } catch (_) {
      return toast(t('msg.photoReadFail'));
    }
    if (photoTarget === 'new') {
      openSheet(null, blob);
      toast(t('msg.classify'));
    } else if (draft) {
      draft.newPhoto = blob;
      draft.dropPhoto = false;
      paintPhoto();
      toast(t('msg.photoAttached'));
    }
  }

  function openLightbox(blob) {
    const url = URL.createObjectURL(blob);
    $('#lightboxImg').src = url;
    $('#lightbox').hidden = false;
    $('#lightbox').dataset.url = url;
  }

  function closeLightbox() {
    const box = $('#lightbox');
    box.hidden = true;
    if (box.dataset.url) {
      URL.revokeObjectURL(box.dataset.url);
      delete box.dataset.url;
    }
    $('#lightboxImg').removeAttribute('src');
  }

  /* ---------------- Exportar / importar ---------------- */

  function download(name, text, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const stamp = () => ymd(new Date());

  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });

  const dataUrlToBlob = (dataUrl) => fetch(dataUrl).then((r) => r.blob());

  async function exportJson() {
    toast(t('msg.exporting'));
    const photos = {};
    for (const e of state.expenses) {
      if (!e.photo) continue;
      const blob = await photoGet(e.photo).catch(() => null);
      if (blob) {
        const url = await blobToDataUrl(blob);
        if (url) photos[e.photo] = url;
      }
    }
    const payload = JSON.stringify(Object.assign({}, state, { photos }), null, 2);
    download('gastos-' + stamp() + '.json', payload, 'application/json');
    toast(t('msg.exported', { mb: (payload.length / 1048576).toFixed(1) }));
  }

  function exportCsv() {
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const header = ['csv.date', 'csv.cat', 'csv.pay', 'csv.note', 'csv.photo', 'csv.amount'].map(t).join(';');
    const lines = [header];
    const rows = state.expenses.slice().sort((a, b) => a.date.localeCompare(b.date));
    for (const e of rows) {
      const pay = payById(e.pay);
      lines.push([
        e.date,
        esc(catName(e.cat)),
        esc(pay ? label(pay, 'pay') : ''),
        esc(e.note || ''),
        e.photo ? t('csv.yes') : '',
        (e.cents / 100).toFixed(2).replace('.', decimalSep)
      ].join(';'));
    }
    download('gastos-' + stamp() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    toast(t('msg.csvExported'));
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(String(reader.result)); } catch (_) { return toast(t('msg.badFile')); }
      if (!data || typeof data !== 'object') return toast(t('msg.badFile'));
      // Una copia puede traer solo deudas, solo gastos, o ambas cosas.
      const lines = data.budgetLines && typeof data.budgetLines === 'object' ? data.budgetLines : null;
      if (!Array.isArray(data.expenses) && !Array.isArray(data.debts) && !Array.isArray(data.pays) && !lines) return toast(t('msg.badFile'));

      const incoming = (data.expenses || []).filter(validExpense);
      const known = new Set(state.expenses.map((e) => e.id));
      const fresh = incoming.filter((e) => !known.has(e.id));

      // Las deudas van por nombre además de por id: una copia preparada aparte
      // no comparte los identificadores de las que ya tienes.
      const debtNames = new Set(state.debts.map((d) => String(d.name || '').toLowerCase()));
      const debtIds = new Set(state.debts.map((d) => d.id));
      const freshDebts = (Array.isArray(data.debts) ? data.debts : []).filter((d) =>
        validDebt(d) && !debtIds.has(d.id) && !debtNames.has(String(d.name).toLowerCase()));

      if (!confirm(t('ask.import', {
        total: incoming.length, fresh: fresh.length, debts: freshDebts.length
      }))) return;

      // Restaura las fotos que vengan en la copia.
      const photos = data.photos && typeof data.photos === 'object' ? data.photos : {};
      for (const e of fresh) {
        if (e.photo && photos[e.photo]) {
          try { await photoPut(e.photo, await dataUrlToBlob(photos[e.photo])); }
          catch (_) { e.photo = null; }
        } else if (e.photo) {
          e.photo = null;   // la copia no traía la imagen
        }
      }

      state.expenses = state.expenses.concat(fresh);
      const merge = (target, incomingList) => {
        if (!Array.isArray(incomingList)) return;
        const ids = new Set(target.map((x) => x.id));
        for (const x of incomingList) if (x && x.id && !ids.has(x.id)) target.push(x);
      };
      merge(state.cats, data.cats);
      merge(state.pays, data.pays);
      merge(state.imports, data.imports);
      if (lines) {                       // presupuesto por rubros: lo que ya tienes puesto no se pisa
        for (const [id, cents] of Object.entries(lines)) {
          if (window.RUBROS.get(id) && Number.isFinite(cents) && cents >= 0 && state.budgetLines[id] === undefined) {
            state.budgetLines[id] = Math.round(cents);
          }
        }
      }

      for (const debt of freshDebts) {
        state.debts.push(Object.assign({
          id: uid(), kind: 'loan', principal: debt.balance, rate: 0, term: 0,
          dueDay: 1, pay: null, paid: [], cat: state.cats.some((c) => c.id === 'banco') ? 'banco' : state.cats[0].id
        }, debt));
      }

      save();
      renderAll();
      toast(freshDebts.length && !fresh.length
        ? tn('msg.importedDebts', freshDebts.length)
        : tn('msg.imported', fresh.length));
    };
    reader.readAsText(file);
  }

  async function wipe() {
    if (!confirm(t('ask.wipe1'))) return;
    if (!confirm(t('ask.wipe2'))) return;
    const keys = await photoKeys().catch(() => []);
    for (const k of keys) await photoDel(k).catch(() => {});
    state.expenses = [];
    save();
    renderAll();
    toast(t('msg.wiped'));
  }

  /* ---------------- Conciliación ---------------- */

  window.RECONCILE.init({
    fmt: fmt,
    toast: toast,
    currency: () => state.currency,
    expenses: () => state.expenses.filter(isSpend),
    pays: () => state.pays,
    payName: (p) => label(p, 'pay'),
    catName: (id) => catName(id),
    dayLabel: (date) => dayLabel(date),
    editExpense: (id) => {
      const e = state.expenses.find((x) => x.id === id);
      if (e) openSheet(e);
    },
    addImported: (list) => addImportedRows(list)
  });

  /* ---------------- Deudas ---------------- */

  // Importe como texto editable, con el separador decimal del idioma: es lo que parseNumber vuelve a leer.
  // Escribir aquí «1239.00» en español se leería como 123900 (el punto sería de miles).
  const amountText = (cents) => (cents / 100).toFixed(2).replace('.', decimalSep);

  function parseNumber(text) {
    const raw = String(text || '').trim().replace(/[^\d.,-]/g, '');
    if (!raw) return 0;
    // El separador decimal depende del idioma y de la moneda.
    const normalized = decimalSep === ','
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
  }

  window.LOANS.init({
    fmt: fmt,
    toast: toast,
    uid: uid,
    save: save,
    decimalSep: () => decimalSep,
    parseNumber: parseNumber,
    parseAmount: (text) => Math.round(parseNumber(text) * 100),
    debts: () => state.debts,
    removeDebt: (id) => { state.debts = state.debts.filter((d) => d.id !== id); save(); },
    pays: () => state.pays,
    payName: (p) => label(p, 'pay'),
    debtCat: () => (state.cats.some((c) => c.id === 'banco') ? 'banco' : state.cats[0].id),
    monthLabel: (d) => cap(monthFmt.format(d)),
    download: (name, text, type) => download(name, text, type),
    // Iniciales de los días en el idioma activo, empezando en lunes.
    weekdayNames: () => {
      const fmtDay = new Intl.DateTimeFormat(moneyLocale(), { weekday: 'narrow' });
      const out = [];
      for (let i = 5; i < 12; i++) out.push(cap(fmtDay.format(new Date(2026, 0, i))));
      return out;
    },
    addExpense: (row) => {
      state.expenses.push({
        id: uid(), cents: row.cents, cat: row.cat, pay: row.pay,
        date: ymd(new Date()), note: row.note, photo: null, src: 'debt', rubro: 'cuotas', ts: Date.now()
      });
      save();
      renderList();
      renderStats();
    }
  });

  /* ---------------- Importar estado de cuenta ---------------- */

  /* Tras importar, ofrece llevar esa tarjeta como deuda. El balance y el pago
     mínimo no se leen del PDF: en los estados de cuenta esas cifras suelen ir
     sin etiqueta de texto (la plantilla las rotula con una imagen de fondo),
     así que adivinarlas por su posición daría cifras equivocadas. Se abre el
     formulario y las copia el usuario. */
  function offerCardDebt(payId) {
    const pay = payId ? payById(payId) : null;
    if (!pay || pay.std) return;                                   // efectivo, transferencia…
    if (state.debts.some((d) => d.name === label(pay, 'pay'))) return;   // ya la lleva
    setTimeout(() => {
      if (!confirm(t('ask.cardDebt', { name: label(pay, 'pay') }))) return;
      go('debts');
      window.LOANS.openNew({ name: label(pay, 'pay'), kind: 'card', pay: pay.id });
    }, 600);
  }

  // statement.js no toca el estado directamente: pide y devuelve por aquí.
  window.STATEMENT.init({
    t: t,
    fmt: fmt,
    toast: toast,
    currency: () => state.currency,
    cats: () => state.cats,
    pays: () => state.pays,
    catName: (c) => (c ? label(c, 'cat') : t('cat.none')),
    catById: catById,
    payName: (p) => label(p, 'pay'),
    monthLabel: (d) => cap(monthFmt.format(d)),
    parseNumber: parseNumber,
    hasCat: (id) => state.cats.some((c) => c.id === id),
    firstCat: () => state.cats[0].id,
    signatures: () => new Set(state.expenses.filter((e) => e.sig).map((e) => e.sig)),
    addPay: (name, icon) => {
      const pay = { id: uid(), icon: icon, name: name, kind: 'card' };
      state.pays.push(pay);
      save();
      return pay.id;
    },
    expenses: () => state.expenses,
    adopt: (id, sig) => {                    // un gasto apuntado a mano/con foto que ya salió en un estado: ya tiene firma
      const e = state.expenses.find((x) => x.id === id);
      if (e && !e.sig) { e.sig = sig; save(); }
    },
    suggestRubros: async (descs) => {
      try {
        const r = await window.SYNC.api('/clasificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comercios: descs }) });
        return r.ok ? (await r.json()).rubros : [];
      } catch (_) { return []; }
    },
    learn: (items) => {
      if (!items.length) return;
      window.SYNC.api('/aprender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) }).catch(() => {});
    },
    addImported: (list) => addImportedRows(list)
  });

  /* ---------------- Facturas con IA (servidor de casa) ---------------- */

  window.BANDEJA.init({
    t: t,
    toast: toast,
    fmt: fmt,
    shrink: shrink,
    parseAmount: (text) => Math.round(parseNumber(text) * 100),
    amountText: (cents) => amountText(cents),
    pays: () => state.pays,
    payName: (p) => label(p, 'pay'),
    addCard: (name) => {
      const pay = { id: uid(), icon: '\u{1F4B3}', name: name, kind: 'card' };
      state.pays.push(pay);
      save();
      return pay.id;
    },
    hasExpense: (id) => state.expenses.some((e) => e.id === id),
    addExpense: (e) => {
      state.expenses.push(e);
      save();
      cursor = startOfMonth(parseDate(e.date));
      renderAll();
    }
  });

  /* ---------------- Cuentas y cobertura de datos ---------------- */

  window.CUENTAS.init({
    t: t,
    fmt: fmt,
    toast: toast,
    parseAmount: (text) => Math.round(parseNumber(text) * 100),
    amountText: (cents) => amountText(cents),
    pays: () => state.pays,
    expenses: () => state.expenses,
    debts: () => state.debts,
    addPay: (pay) => { state.pays.push(Object.assign({ id: 'acct_' + uid() }, pay)); save(); },
    save: save,
    renderAll: renderAll
  });

  /* ---------------- Bolsillo (efectivo) ---------------- */

  window.BOLSILLO.init({
    t: t,
    tn: tn,
    fmt: fmt,
    toast: toast,
    parseAmount: (text) => Math.round(parseNumber(text) * 100),
    amountText: (cents) => amountText(cents),
    pays: () => state.pays,
    expenses: () => state.expenses,
    payName: (id) => payLabel(id),
    catName: (id) => catName(id),
    monthKey: () => monthKey(new Date()),
    monthLabel: () => cap(monthFmt.format(new Date())),
    openExpense: (id) => {
      const e = state.expenses.find((x) => x.id === id);
      if (e) openSheet(e);
    },
    newEntry: (preset) => openSheet(null, null, preset),
    save: save,
    renderAll: renderAll
  });

  /* ---------------- Presupuesto por rubros ---------------- */

  window.PRESUPUESTO.init({
    t: t,
    fmt: fmt,
    toast: toast,
    parseAmount: (text) => Math.round(parseNumber(text) * 100),
    amountText: (cents) => amountText(cents),
    month: () => cursor,
    monthLabel: () => cap(monthFmt.format(cursor)),
    shiftMonth: (n) => { shiftMonth(n); },
    entries: (d) => entriesOfMonth(d),
    isIncome: isIncome,
    debts: () => state.debts,
    lines: () => state.budgetLines,
    setLine: (id, cents) => {
      if (cents > 0) state.budgetLines[id] = cents; else delete state.budgetLines[id];
      save();
    },
    openExpense: (id) => {
      const e = state.expenses.find((x) => x.id === id);
      if (e) openSheet(e);
    }
  });

  // La usan tanto la importación como la conciliación al apuntar lo que falta.
  function addImportedRows(list) {
    if (!list.length) return;
    const now = Date.now();
    // Un lote por archivo, aunque se hayan abierto varios de golpe: así se
    // puede deshacer el estado de un mes concreto sin tocar los demás.
    const batches = new Map();
    for (const row of list) {
      const file = row.file || 'PDF';
      if (!batches.has(file)) batches.set(file, 'b_' + uid());
      state.expenses.push({
        id: uid(), cents: row.cents, cat: row.cat, pay: row.pay,
        date: row.date, note: row.note, photo: null,
        sig: row.sig, src: row.src || 'pdf', rubro: row.rubro, batch: batches.get(file), ts: now
      });
    }
    for (const [file, batch] of batches) {
      const mine = list.filter((r) => (r.file || 'PDF') === file);
      state.imports.push({
        id: batch,
        file: file,
        when: ymd(new Date()),
        count: mine.length,
        cents: mine.reduce((s, r) => s + r.cents, 0)
      });
    }
    save();
    // Deja a la vista el mes del último movimiento importado.
    const last = list.map((r) => r.date).sort().pop();
    if (last) cursor = startOfMonth(parseDate(last));
    renderAll();
    toast(tn('imp.imported', list.length));
    offerCardDebt(list[0].pay);
  }

  /* ---------------- Navegación ---------------- */

  function go(name) {
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
    $$('.tab[data-go]').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.go === name));
    // Apuntar un gasto se hace desde la lista y desde el resumen; en deudas y
    // ajustes los botones flotantes taparían los suyos.
    const canAdd = name === 'list' || name === 'stats';   // en Presupuesto, Bolsillo, Deudas y Ajustes los botones flotantes taparían los suyos
    $('#openAdd').hidden = !canAdd;
    $('#openCam').hidden = !canAdd;
    if (name === 'debts') window.LOANS.render();
    if (name === 'budget') window.PRESUPUESTO.render();
    if (name === 'pocket') window.BOLSILLO.render();
  }

  function shiftMonth(n) {
    cursor = addMonths(cursor, n);
    renderList();
    renderStats();
    if (window.PRESUPUESTO) window.PRESUPUESTO.render();
  }

  function setLanguage(code) {
    window.I18N.set(code);
    state.lang = window.I18N.current();
    save();
    window.I18N.apply();
    renderAll();
    if (draft) {               // la hoja está abierta: sus textos también cambian
      $('#sheetTitle').textContent = t(draft.id ? 'sheet.edit' : 'sheet.new');
      renderPickers();
      paintPhoto();
    }
  }

  /* ---------------- Eventos ---------------- */

  $$('.monthnav').forEach((b) => b.addEventListener('click', () => shiftMonth(Number(b.dataset.month))));
  $$('.tab[data-go]').forEach((tab) => tab.addEventListener('click', () => go(tab.dataset.go)));

  $('#openAdd').addEventListener('click', () => openSheet(null));
  // La cámara manda la factura a la IA del servidor; el «+» sigue siendo apuntar a mano.
  $('#openCam').addEventListener('click', () => $('#aiFile').click());
  $('#aiFile').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) window.BANDEJA.send(file);
  });
  $('#kindExpense').addEventListener('click', () => { draft.kind = 'expense'; draft.rubro = null; renderPickers(); });
  // Ingresos y transferencias parten de una cuenta bancaria si hay (no de «Efectivo», que es la primera forma de pago).
  const firstAccount = () => state.pays.find((p) => p.kind === 'account');
  $('#kindIncome').addEventListener('click', () => { draft.kind = 'income'; draft.rubro = null; if (firstAccount() && !draft.id) draft.pay = firstAccount().id; renderPickers(); });
  $('#kindTransfer').addEventListener('click', () => { draft.kind = 'transfer'; draft.rubro = null; if (firstAccount() && !draft.id) draft.pay = firstAccount().id; renderPickers(); });
  $('#rubroSelect').addEventListener('change', (ev) => {
    draft.rubro = ev.target.value || null;
    const cat = draft.rubro && window.RUBROS.catOf(draft.rubro);
    if (cat && state.cats.some((c) => c.id === cat)) draft.cat = cat;
    renderPickers();
  });
  $('#attachPhoto').addEventListener('click', () => pickPhoto('sheet'));
  $('#photoDel').addEventListener('click', () => {
    draft.newPhoto = null;
    draft.dropPhoto = true;
    paintPhoto();
  });
  $('#photoImg').addEventListener('click', () => {
    if (draft && draft.newPhoto) return openLightbox(draft.newPhoto);
    if (draft && draft.photo && !draft.dropPhoto) {
      photoGet(draft.photo).then((b) => { if (b) openLightbox(b); }).catch(() => {});
    }
  });
  $('#lightbox').addEventListener('click', closeLightbox);

  $('#photoFile').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';   // permite volver a elegir la misma foto
    onPhotoPicked(file);
  });

  $('#cancelBtn').addEventListener('click', closeSheet);
  $('#backdrop').addEventListener('click', closeSheet);
  $('#saveBtn').addEventListener('click', saveDraft);
  $('#deleteBtn').addEventListener('click', deleteDraft);

  $('#keypad').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-k]');
    if (btn) press(btn.dataset.k);
  });

  $('#listBody').addEventListener('click', (ev) => {
    const row = ev.target.closest('.item');
    if (!row) return;
    const e = state.expenses.find((x) => x.id === row.dataset.id);
    if (e) openSheet(e);
  });

  $('#lang').addEventListener('change', (ev) => setLanguage(ev.target.value));

  $('#currency').addEventListener('change', (ev) => {
    state.currency = ev.target.value;
    save();
    renderAll();
  });

  $('#budget').addEventListener('change', (ev) => {
    const raw = ev.target.value.trim().replace(/[^\d.,-]/g, '');
    // Quita separadores de millar y normaliza el decimal del idioma activo.
    const normalized = decimalSep === ','
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
    const n = parseFloat(normalized);
    state.budget = Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
    save();
    renderAll();
  });

  function wireAddForm(formSel, iconSel, nameSel, list, fallbackIcon, okKey) {
    $(formSel).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = $(nameSel).value.trim();
      if (!name) return;
      list().push({ id: uid(), icon: $(iconSel).value.trim() || fallbackIcon, name });
      save();
      $(nameSel).value = '';
      $(iconSel).value = '';
      renderAll();
      toast(t(okKey));
    });
  }
  wireAddForm('#addCatForm', '#newCatIcon', '#newCatName', () => state.cats, '\u{1F4B6}', 'msg.catAdded');
  wireAddForm('#addPayForm', '#newPayIcon', '#newPayName', () => state.pays, '\u{1F4B3}', 'msg.payAdded');

  $('#exportJson').addEventListener('click', exportJson);
  $('#exportCsv').addEventListener('click', exportCsv);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (file) importJson(file);
    ev.target.value = '';
  });
  $('#wipeBtn').addEventListener('click', wipe);

  $('#importPdf').addEventListener('click', () => $('#pdfFile').click());
  $('#pdfFile').addEventListener('change', (ev) => {
    const files = Array.from(ev.target.files);   // copia: en Chrome la lista original se vacía al limpiar el campo
    ev.target.value = '';
    if (files && files.length) window.STATEMENT.open(files);
  });

  $('#reconcilePdf').addEventListener('click', () => $('#recFile').click());
  $('#recFile').addEventListener('change', (ev) => {
    const files = Array.from(ev.target.files);   // copia: en Chrome la lista original se vacía al limpiar el campo
    ev.target.value = '';
    if (files && files.length) window.RECONCILE.open(files);
  });

  // Evita el zoom por doble toque en iOS sin bloquear los toques normales.
  let lastTouch = 0;
  document.addEventListener('touchend', (ev) => {
    const now = Date.now();
    if (now - lastTouch < 320) ev.preventDefault();
    lastTouch = now;
  }, { passive: false });

  /* ---------------- Arranque ---------------- */

  window.I18N.set(window.I18N.detect(state.lang));
  window.I18N.apply();
  renderAll();
  go('stats');   // el resumen del mes es lo primero que se ve al abrir

  /* ---------------- Sincronización con el servidor ---------------- */

  function reloadFromStorage() {
    state = load();
    window.I18N.set(window.I18N.detect(state.lang));
    window.I18N.apply();
    renderAll();
  }

  window.SYNC.init({
    getState: () => state,
    hasData: () => state.expenses.length > 0 || state.debts.length > 0 || Object.keys(state.budgetLines).length > 0,
    replaceState: (datos) => {
      try { localStorage.setItem(KEY, JSON.stringify(datos)); } catch (_) { return; }
      reloadFromStorage();
    },
    onConflict: (server) => {
      window.SYNC.resolve(server, confirm(t('sync.conflict')));
    },
    synced: (ok) => {
      const el = $('#syncNote');
      if (el) el.textContent = t(ok ? 'sync.ok' : 'sync.pending');
    },
    photoLocalGet: photoLocalGet
  });
  syncReady = true;

  // Pide almacenamiento persistente: reduce el riesgo de que iOS purgue los datos.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((ok) => { if (!ok) navigator.storage.persist(); });
  }

  /* Actualización automática. Sin esto, una versión nueva solo llega cuando el
     usuario cierra la app del todo y la vuelve a abrir (dos veces), y en un
     iPhone con la PWA instalada eso no es evidente. */
  if ('serviceWorker' in navigator) {
    // Si ya había un service worker al cargar, esta página es una versión
    // anterior: cuando el nuevo tome el control, hay que recargar. En la
    // primera instalación no, o recargaría nada más entrar.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Nunca en mitad de un gasto a medio escribir.
      if (!hadController || reloading || draft) return;
      reloading = true;
      location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        navigator.serviceWorker.ready.then(showVersion);   // la caché aparece cuando el SW termina de instalarse
        const check = () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        };
        check();                                              // al abrir
        document.addEventListener('visibilitychange', check); // al volver a primer plano
      }).catch(() => {});
    });
  }
})();
