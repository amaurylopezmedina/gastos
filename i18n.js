/* Traducciones. Para añadir un idioma: copia un bloque, tradúcelo y
   añádelo a LANGS; el selector de Ajustes se rellena solo. */
window.I18N = (() => {
  'use strict';

  const DICT = {

    /* ---------------- Español ---------------- */
    es: {
      'locale': 'es-ES',
      'lang.name': 'Español',

      'nav.prev': 'Mes anterior',
      'nav.next': 'Mes siguiente',
      'tab.list': 'Gastos',
      'tab.stats': 'Resumen',
      'tab.settings': 'Ajustes',

      'hero.total': 'Total del mes',
      'list.count.one': '{n} apunte',
      'list.count.other': '{n} apuntes',
      'list.empty.title': 'Sin gastos este mes.',
      'list.empty.hint': 'Pulsa + para añadir el primero.',
      'day.today': 'Hoy',
      'day.yesterday': 'Ayer',
      'budget.left': '{left} disponibles de {total}',
      'budget.over': '{over} por encima del presupuesto',

      'stats.title': 'Resumen',
      'stats.month': 'Este mes',
      'stats.avg': 'Media / día',
      'stats.count': 'Apuntes',
      'stats.delta': 'vs. mes anterior',
      'stats.nodata': 'sin dato',
      'stats.byCat': 'Por categoría',
      'stats.byPay': 'A pagar por método',
      'stats.last6': 'Últimos 6 meses',
      'stats.empty': 'Nada que resumir todavía.',

      'set.general': 'General',
      'set.language': 'Idioma',
      'set.currency': 'Moneda',
      'set.budget': 'Presupuesto mensual',
      'set.budget.ph': 'sin límite',
      'set.cats': 'Categorías',
      'set.cat.ph': 'Nueva categoría',
      'set.pays': 'Formas de pago',
      'set.pay.ph': 'Visa Santander…',
      'set.pays.hint': 'Añade aquí cada tarjeta o cuenta. En Resumen verás cuánto toca pagar de cada una este mes.',
      'set.add': 'Añadir',
      'set.remove': 'Quitar',
      'set.data': 'Tus datos',
      'set.export.json': 'Exportar copia de seguridad',
      'set.export.csv': 'Exportar para Excel',
      'set.import': 'Importar copia de seguridad',
      'set.wipe': 'Borrar todos los gastos',
      'set.storage': 'Los datos se guardan solo en este dispositivo. Exporta de vez en cuando para no perderlos.',
      'set.usage.count.one': '{n} gasto',
      'set.usage.count.other': '{n} gastos',
      'set.usage.photos': '{n} con foto',
      'set.usage.size': '{mb} MB ocupados',
      'set.used.one': '{n} uso',
      'set.used.other': '{n} usos',

      'sheet.new': 'Nuevo gasto',
      'sheet.edit': 'Editar gasto',
      'sheet.cancel': 'Cancelar',
      'sheet.save': 'Guardar',
      'sheet.cat': 'Categoría',
      'sheet.pay': 'Forma de pago',
      'sheet.note.ph': 'Nota (opcional)',
      'sheet.delete': 'Eliminar gasto',
      'photo.add': 'Adjuntar factura o tíquet',
      'photo.change': 'Cambiar foto',
      'photo.remove': 'Quitar foto',
      'photo.alt': 'Foto del gasto',
      'photo.close': 'Cerrar',

      'fab.add': 'Añadir gasto',
      'fab.cam': 'Fotografiar factura',

      'msg.saved': 'Guardado',
      'msg.added': 'Gasto añadido',
      'msg.deleted': 'Gasto eliminado',
      'msg.catAdded': 'Categoría añadida',
      'msg.payAdded': 'Forma de pago añadida',
      'msg.needAmount': 'Introduce un importe',
      'msg.photoAttached': 'Foto adjunta',
      'msg.photoWorking': 'Procesando foto…',
      'msg.classify': 'Ahora clasifica el gasto',
      'msg.photoReadFail': 'No se pudo leer la imagen',
      'msg.photoSaveFail': 'No se pudo guardar la foto',
      'msg.full': 'No se pudo guardar: almacenamiento lleno',
      'msg.exporting': 'Preparando copia…',
      'msg.exported': 'Copia exportada ({mb} MB)',
      'msg.csvExported': 'CSV exportado',
      'msg.badFile': 'Archivo no válido',
      'msg.imported.one': '{n} gasto importado',
      'msg.imported.other': '{n} gastos importados',
      'msg.wiped': 'Todo borrado',
      'msg.keepOne': 'Deja al menos una',

      'ask.deleteExpense': '¿Eliminar este gasto?',
      'ask.removeCat': '¿Quitar esta categoría?',
      'ask.removePay': '¿Quitar esta forma de pago?',
      'ask.removeCatUsed': 'Hay {n} gasto(s) con esta categoría. Se quedarán sin categoría. ¿Quitarla igualmente?',
      'ask.removePayUsed': 'Hay {n} gasto(s) con esta forma de pago. Se quedarán sin forma de pago. ¿Quitarla igualmente?',
      'ask.import': 'El archivo tiene {total} gasto(s). Se añadirán {fresh} nuevos (los repetidos se ignoran). ¿Continuar?',
      'ask.wipe1': 'Se borrarán TODOS los gastos y sus fotos de este dispositivo. ¿Seguro?',
      'ask.wipe2': 'Esta acción no se puede deshacer. ¿Confirmas?',

      'cat.none': 'Sin categoría',
      'pay.none': 'Sin forma de pago',
      'cat.comida': 'Comida',
      'cat.super': 'Super',
      'cat.transpor': 'Transporte',
      'cat.casa': 'Casa',
      'cat.ocio': 'Ocio',
      'cat.salud': 'Salud',
      'cat.ropa': 'Ropa',
      'cat.subs': 'Suscripciones',
      'cat.otros': 'Otros',
      'pay.efectivo': 'Efectivo',
      'pay.tarjeta': 'Tarjeta',
      'pay.transfer': 'Transferencia',

      'csv.date': 'Fecha',
      'csv.cat': 'Categoria',
      'csv.pay': 'Forma de pago',
      'csv.note': 'Nota',
      'csv.photo': 'Foto',
      'csv.amount': 'Importe',
      'csv.yes': 'si'
    },

    /* ---------------- English ---------------- */
    en: {
      'locale': 'en-US',
      'lang.name': 'English',

      'nav.prev': 'Previous month',
      'nav.next': 'Next month',
      'tab.list': 'Expenses',
      'tab.stats': 'Summary',
      'tab.settings': 'Settings',

      'hero.total': 'Month total',
      'list.count.one': '{n} entry',
      'list.count.other': '{n} entries',
      'list.empty.title': 'No expenses this month.',
      'list.empty.hint': 'Tap + to add the first one.',
      'day.today': 'Today',
      'day.yesterday': 'Yesterday',
      'budget.left': '{left} left of {total}',
      'budget.over': '{over} over budget',

      'stats.title': 'Summary',
      'stats.month': 'This month',
      'stats.avg': 'Daily average',
      'stats.count': 'Entries',
      'stats.delta': 'vs. last month',
      'stats.nodata': 'no data',
      'stats.byCat': 'By category',
      'stats.byPay': 'Due by payment method',
      'stats.last6': 'Last 6 months',
      'stats.empty': 'Nothing to summarise yet.',

      'set.general': 'General',
      'set.language': 'Language',
      'set.currency': 'Currency',
      'set.budget': 'Monthly budget',
      'set.budget.ph': 'no limit',
      'set.cats': 'Categories',
      'set.cat.ph': 'New category',
      'set.pays': 'Payment methods',
      'set.pay.ph': 'Visa …1234',
      'set.pays.hint': 'Add each card or account here. Summary shows how much each one owes this month.',
      'set.add': 'Add',
      'set.remove': 'Remove',
      'set.data': 'Your data',
      'set.export.json': 'Export backup',
      'set.export.csv': 'Export for Excel',
      'set.import': 'Import backup',
      'set.wipe': 'Delete all expenses',
      'set.storage': 'Data is stored on this device only. Export now and then so you do not lose it.',
      'set.usage.count.one': '{n} expense',
      'set.usage.count.other': '{n} expenses',
      'set.usage.photos': '{n} with photo',
      'set.usage.size': '{mb} MB used',
      'set.used.one': '{n} use',
      'set.used.other': '{n} uses',

      'sheet.new': 'New expense',
      'sheet.edit': 'Edit expense',
      'sheet.cancel': 'Cancel',
      'sheet.save': 'Save',
      'sheet.cat': 'Category',
      'sheet.pay': 'Payment method',
      'sheet.note.ph': 'Note (optional)',
      'sheet.delete': 'Delete expense',
      'photo.add': 'Attach receipt',
      'photo.change': 'Change photo',
      'photo.remove': 'Remove photo',
      'photo.alt': 'Expense photo',
      'photo.close': 'Close',

      'fab.add': 'Add expense',
      'fab.cam': 'Photograph receipt',

      'msg.saved': 'Saved',
      'msg.added': 'Expense added',
      'msg.deleted': 'Expense deleted',
      'msg.catAdded': 'Category added',
      'msg.payAdded': 'Payment method added',
      'msg.needAmount': 'Enter an amount',
      'msg.photoAttached': 'Photo attached',
      'msg.photoWorking': 'Processing photo…',
      'msg.classify': 'Now classify the expense',
      'msg.photoReadFail': 'Could not read the image',
      'msg.photoSaveFail': 'Could not save the photo',
      'msg.full': 'Could not save: storage is full',
      'msg.exporting': 'Preparing backup…',
      'msg.exported': 'Backup exported ({mb} MB)',
      'msg.csvExported': 'CSV exported',
      'msg.badFile': 'Invalid file',
      'msg.imported.one': '{n} expense imported',
      'msg.imported.other': '{n} expenses imported',
      'msg.wiped': 'Everything deleted',
      'msg.keepOne': 'Keep at least one',

      'ask.deleteExpense': 'Delete this expense?',
      'ask.removeCat': 'Remove this category?',
      'ask.removePay': 'Remove this payment method?',
      'ask.removeCatUsed': '{n} expense(s) use this category. They will be left without one. Remove it anyway?',
      'ask.removePayUsed': '{n} expense(s) use this payment method. They will be left without one. Remove it anyway?',
      'ask.import': 'The file holds {total} expense(s). {fresh} new ones will be added (duplicates are skipped). Continue?',
      'ask.wipe1': 'This deletes ALL expenses and their photos from this device. Are you sure?',
      'ask.wipe2': 'This cannot be undone. Confirm?',

      'cat.none': 'No category',
      'pay.none': 'No payment method',
      'cat.comida': 'Eating out',
      'cat.super': 'Groceries',
      'cat.transpor': 'Transport',
      'cat.casa': 'Home',
      'cat.ocio': 'Leisure',
      'cat.salud': 'Health',
      'cat.ropa': 'Clothes',
      'cat.subs': 'Subscriptions',
      'cat.otros': 'Other',
      'pay.efectivo': 'Cash',
      'pay.tarjeta': 'Card',
      'pay.transfer': 'Bank transfer',

      'csv.date': 'Date',
      'csv.cat': 'Category',
      'csv.pay': 'Payment method',
      'csv.note': 'Note',
      'csv.photo': 'Photo',
      'csv.amount': 'Amount',
      'csv.yes': 'yes'
    }
  };

  const LANGS = Object.keys(DICT);
  let lang = 'es';

  const fill = (str, vars) => {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  };

  function t(key, vars) {
    const d = DICT[lang] || DICT.en;
    const str = key in d ? d[key] : (key in DICT.en ? DICT.en[key] : key);
    return fill(str, vars);
  }

  // Plural simple: suficiente para es/en. Un idioma con más formas
  // necesitaría Intl.PluralRules aquí.
  function tn(base, n, vars) {
    return t(base + (n === 1 ? '.one' : '.other'), Object.assign({ n: n }, vars));
  }

  function detect(saved) {
    if (saved && DICT[saved]) return saved;
    const nav = (navigator.languages || [navigator.language || 'es']).map((l) => String(l).slice(0, 2));
    for (const code of nav) if (DICT[code]) return code;
    return 'es';
  }

  function set(code) {
    lang = DICT[code] ? code : 'es';
    document.documentElement.lang = lang;
    return lang;
  }

  /* Aplica las traducciones a los nodos marcados en el HTML. */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    scope.querySelectorAll('[data-i18n-alt]').forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
  }

  return {
    t: t,
    tn: tn,
    set: set,
    apply: apply,
    detect: detect,
    langs: () => LANGS.map((code) => ({ code: code, name: DICT[code]['lang.name'] })),
    locale: () => t('locale'),
    current: () => lang
  };
})();
