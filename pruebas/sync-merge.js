// Pruebas de la combinación de sync.js (sin navegador): node pruebas/sync-merge.js
const fs = require('fs');
global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.document = { addEventListener() {} };
eval(fs.readFileSync(__dirname + '/../sync.js', 'utf8').replace('window.SYNC =', 'global.SYNC ='));
const { merge3 } = global.SYNC;
let ok = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(nombre, cond, extra) { if (cond) ok++; else { fail++; console.log('FALLA:', nombre, extra ? JSON.stringify(extra) : ''); } }
const E = (id, o) => Object.assign({ id, cents: 100, date: '2026-10-01', pay: 'efectivo' }, o);
const base = { v: 3, currency: 'DOP', expenses: [E('a'), E('b')], pays: [{ id: 'efectivo' }, { id: 'acct', opening: 100 }], debts: [], cats: [], imports: [], budgetLines: { luz: 500 } };
const clon = (o) => JSON.parse(JSON.stringify(o));
const ids = (m) => m.expenses.map((x) => x.id).sort().join(',');

// 1. cada lado agrega un gasto distinto → quedan los dos
{ const l = clon(base); l.expenses.push(E('x')); const s = clon(base); s.expenses.push(E('y')); t('agregados en ambos lados', ids(merge3(base, l, s)) === 'a,b,x,y'); }
// 2. solo cambió el servidor (saldo de una cuenta) → se queda el del servidor
{ const l = clon(base); const s = clon(base); s.pays[1].opening = 999; t('solo cambia el servidor', merge3(base, l, s).pays.find((p) => p.id === 'acct').opening === 999); }
// 3. solo cambié yo → se queda lo mío
{ const l = clon(base); l.expenses[0].note = 'mi nota'; const s = clon(base); t('solo cambio yo', merge3(base, l, s).expenses.find((x) => x.id === 'a').note === 'mi nota'); }
// 4. cambiamos lo mismo en los dos → gana lo de aquí
{ const l = clon(base); l.expenses[0].note = 'aqui'; const s = clon(base); s.expenses[0].note = 'servidor'; t('ambos cambian lo mismo: gana lo local', merge3(base, l, s).expenses.find((x) => x.id === 'a').note === 'aqui'); }
// 5. borré un gasto aquí y el servidor no lo tocó → se borra
{ const l = clon(base); l.expenses = l.expenses.filter((x) => x.id !== 'a'); const s = clon(base); t('borrado local sin tocar en el servidor', ids(merge3(base, l, s)) === 'b'); }
// 6. se borró en el servidor y aquí no se tocó → se borra
{ const l = clon(base); const s = clon(base); s.expenses = s.expenses.filter((x) => x.id !== 'b'); t('borrado en el servidor sin tocar aquí', ids(merge3(base, l, s)) === 'a'); }
// 7. lo borré aquí pero el servidor lo EDITÓ → se conserva la edición (no se pierde trabajo)
{ const l = clon(base); l.expenses = l.expenses.filter((x) => x.id !== 'a'); const s = clon(base); s.expenses[0].note = 'editado'; t('borrado aquí pero editado en el servidor', merge3(base, l, s).expenses.some((x) => x.id === 'a' && x.note === 'editado')); }
// 8. sin referencia (primera vez): se conserva lo exclusivo de cada lado y, si choca, manda el servidor
{ const l = { v: 3, expenses: [E('x'), E('a', { note: 'local' })], pays: [{ id: 'acct', opening: 1 }] }; const s = { v: 3, expenses: [E('y'), E('a', { note: 'srv' })], pays: [{ id: 'acct', opening: 2 }] };
  const m = merge3(null, l, s); t('sin base: unión', ids(m) === 'a,x,y'); t('sin base: choque lo gana el servidor', m.expenses.find((x) => x.id === 'a').note === 'srv' && m.pays[0].opening === 2); }
// 9. valores sueltos y presupuesto por rubro
{ const l = clon(base); l.currency = 'USD'; l.budgetLines.agua = 200; const s = clon(base); s.budgetLines.luz = 700; const m = merge3(base, l, s);
  t('moneda cambiada aquí', m.currency === 'USD'); t('presupuesto: lo nuevo local y lo cambiado del servidor', m.budgetLines.agua === 200 && m.budgetLines.luz === 700, m.budgetLines); }
// 10. el caso real: aquí solo arrancó el bolsillo; el servidor cambió cuentas y gastos
{ const l = clon(base); l.pays[0].openingDate = '2026-10-03'; const s = clon(base); s.pays[1].opening = 2163507; s.expenses.push(E('nuevo', { cents: 570000 })); s.debts.push({ id: 'd1', name: 'Tarjeta' });
  const m = merge3(base, l, s); t('caso real: lo mío', m.pays[0].openingDate === '2026-10-03'); t('caso real: lo del servidor', m.pays[1].opening === 2163507 && ids(m) === 'a,b,nuevo' && m.debts.length === 1, m); }
// 11. idempotencia: combinar dos veces da lo mismo
{ const l = clon(base); l.expenses.push(E('x')); const s = clon(base); s.expenses.push(E('y')); const m1 = merge3(base, l, s); const m2 = merge3(s, m1, s); t('idempotente', eq(Object.keys(m1).sort(), Object.keys(m2).sort()) && ids(m2) === 'a,b,x,y'); }
// 12. eventos: se combinan como el resto de las listas (cada lado crea uno distinto; el borrado de un lado sin tocar se aplica)
{ const b2 = Object.assign(clon(base), { events: [{ id: 'ev1', name: 'Viaje' }], activeEvent: 'ev1' }); b2.expenses[0].event = 'ev1';
  const l = clon(b2); l.events.push({ id: 'ev2', name: 'Fiesta' }); const s2 = clon(b2); s2.events.push({ id: 'ev3', name: 'Compra' });
  const m = merge3(b2, l, s2); t('eventos: se unen los creados en cada lado', m.events.map((e) => e.id).sort().join(',') === 'ev1,ev2,ev3', m.events);
  const l2 = clon(b2); l2.events = []; l2.activeEvent = null; delete l2.expenses[0].event; const s3 = clon(b2); const m2 = merge3(b2, l2, s3);
  t('eventos: borrado local sin tocar en el servidor', m2.events.length === 0 && m2.activeEvent === null && m2.expenses.find((x) => x.id === 'a').event === undefined, m2); }
console.log(`${ok} pruebas bien, ${fail} fallos`);
process.exit(fail ? 1 : 0);
