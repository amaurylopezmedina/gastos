/* Rubros del presupuesto: la plantilla de gastos, en 11 secciones.

   Un rubro es la línea del presupuesto («Supermercado», «Luz»…). Cada gasto puede llevar
   su rubro además de la categoría de siempre; la categoría se deduce del rubro (campo
   `cat`), así lo que ya funciona sin rubros no se rompe.

   Aquí NO hay importes: los montos del presupuesto son del usuario y viven en sus datos.
   El servidor lee esta misma lista (servidor/rubros.py la analiza), así que no hay copia
   que se desincronice: para añadir un rubro basta con una línea en RAW. */
window.RUBROS = (() => {
  'use strict';

  const GROUPS = [
    { id: 'ing', es: 'Ingresos',            en: 'Income',               icon: '\u{1F4B0}', income: true },
    { id: 'viv', es: 'Vivienda',            en: 'Housing',              icon: '\u{1F3E0}' },
    { id: 'ali', es: 'Alimentación',        en: 'Food',                 icon: '\u{1F6D2}' },
    { id: 'tra', es: 'Transporte',          en: 'Transport',            icon: '\u{1F697}' },
    { id: 'sal', es: 'Salud',               en: 'Health',               icon: '\u{1F48A}' },
    { id: 'edu', es: 'Educación',           en: 'Education',            icon: '\u{1F393}' },
    { id: 'per', es: 'Personal y ocio',     en: 'Personal and leisure', icon: '\u{1F6CD}\u{FE0F}' },
    { id: 'fam', es: 'Familia y compromisos', en: 'Family and commitments', icon: '\u{1F46A}' },
    { id: 'aho', es: 'Ahorro e imprevistos', en: 'Savings and surprises', icon: '\u{1F6DF}' },
    { id: 'deu', es: 'Deudas',              en: 'Debts',                icon: '\u{1F3E6}' }
  ];

  // [id, grupo, español, inglés, categoría de la app]
  const RAW = [
    ['sueldo', 'ing', 'Sueldo neto', 'Net salary', 'otros'],
    ['ing_otros', 'ing', 'Otros ingresos fijos', 'Other fixed income', 'otros'],
    ['ing_var', 'ing', 'Ingresos variables', 'Variable income', 'otros'],
    ['regalia', 'ing', 'Regalía pascual (÷12)', 'Christmas bonus (÷12)', 'otros'],
    ['bonif', 'ing', 'Bonificación anual (÷12)', 'Annual bonus (÷12)', 'otros'],
    ['conyuge', 'ing', 'Ingreso del cónyuge', 'Spouse income', 'otros'],

    ['alquiler', 'viv', 'Alquiler o hipoteca', 'Rent or mortgage', 'casa'],
    ['condominio', 'viv', 'Condominio / mantenimiento', 'Building fees', 'casa'],
    ['luz', 'viv', 'Luz', 'Electricity', 'casa'],
    ['agua', 'viv', 'Agua', 'Water', 'casa'],
    ['gas', 'viv', 'Gas', 'Gas', 'casa'],
    ['internet', 'viv', 'Internet, teléfono y cable', 'Internet, phone and TV', 'casa'],
    ['domestico', 'viv', 'Servicio doméstico', 'Domestic help', 'casa'],
    ['reparaciones', 'viv', 'Reparaciones y hogar', 'Repairs and home', 'casa'],
    ['planta', 'viv', 'Planta, inversor o baterías', 'Generator, inverter or batteries', 'casa'],
    ['camion_agua', 'viv', 'Camión de agua / botellones', 'Water truck / bottles', 'casa'],
    ['basura', 'viv', 'Basura y seguridad', 'Waste and security', 'casa'],

    ['super', 'ali', 'Supermercado', 'Groceries', 'super'],
    ['comerfuera', 'ali', 'Comer fuera y delivery', 'Eating out and delivery', 'comida'],
    ['colmado', 'ali', 'Colmado y compras pequeñas', 'Corner shop and small buys', 'super'],
    ['almuerzos', 'ali', 'Almuerzos de trabajo', 'Work lunches', 'comida'],

    ['combustible', 'tra', 'Combustible', 'Fuel', 'transpor'],
    ['mant_veh', 'tra', 'Mantenimiento del vehículo', 'Vehicle maintenance', 'transpor'],
    ['seguro_veh', 'tra', 'Seguro del vehículo', 'Vehicle insurance', 'transpor'],
    ['marbete', 'tra', 'Marbete e inspección (÷12)', 'Registration and inspection (÷12)', 'transpor'],
    ['neumaticos', 'tra', 'Neumáticos (÷12)', 'Tires (÷12)', 'transpor'],
    ['lavado', 'tra', 'Lavado y parqueos', 'Car wash and parking', 'transpor'],
    ['transporte', 'tra', 'Transporte y viajes', 'Transport and trips', 'transpor'],
    ['multas', 'tra', 'Multas', 'Fines', 'transpor'],

    ['ars', 'sal', 'Seguro médico (ARS)', 'Health insurance', 'salud'],
    ['farmacia', 'sal', 'Farmacia', 'Pharmacy', 'salud'],
    ['consultas', 'sal', 'Consultas y laboratorios', 'Appointments and labs', 'salud'],
    ['dentista', 'sal', 'Dentista', 'Dentist', 'salud'],
    ['optica', 'sal', 'Óptica y lentes (÷12)', 'Optician and glasses (÷12)', 'salud'],
    ['medperm', 'sal', 'Medicamentos permanentes', 'Ongoing medication', 'salud'],

    ['colegio', 'edu', 'Colegio / universidad', 'School / university', 'otros'],
    ['materiales', 'edu', 'Materiales y libros', 'Materials and books', 'otros'],
    ['uniformes', 'edu', 'Uniformes y útiles (÷12)', 'Uniforms and supplies (÷12)', 'otros'],
    ['transp_escolar', 'edu', 'Transporte escolar', 'School transport', 'otros'],
    ['cursos', 'edu', 'Cursos y certificaciones', 'Courses and certifications', 'otros'],

    ['ropa', 'per', 'Ropa y calzado', 'Clothes and shoes', 'ropa'],
    ['cuidado', 'per', 'Cuidado personal', 'Personal care', 'otros'],
    ['ocio', 'per', 'Ocio y salidas', 'Leisure and outings', 'ocio'],
    ['suscripciones', 'per', 'Suscripciones', 'Subscriptions', 'subs'],
    ['regalos', 'per', 'Regalos y cumpleaños', 'Gifts and birthdays', 'ocio'],
    ['navidad', 'per', 'Navidad y fin de año (÷12)', 'Christmas and New Year (÷12)', 'ocio'],
    ['vacaciones', 'per', 'Vacaciones (÷12)', 'Holidays (÷12)', 'ocio'],
    ['mascotas', 'per', 'Mascotas', 'Pets', 'otros'],
    ['tecnologia', 'per', 'Tecnología y equipos (÷12)', 'Technology and gear (÷12)', 'otros'],

    ['ayudas', 'fam', 'Ayudas familiares', 'Family support', 'otros'],
    ['pension', 'fam', 'Pensión alimenticia', 'Child support', 'otros'],
    ['ninera', 'fam', 'Cuidado de hijos / niñera', 'Childcare', 'otros'],
    ['seguro_vida', 'fam', 'Seguro de vida', 'Life insurance', 'otros'],
    ['iglesia', 'fam', 'Iglesia y donaciones', 'Church and donations', 'otros'],
    ['impuestos', 'fam', 'Impuestos y TSS', 'Taxes and social security', 'otros'],
    ['honorarios', 'fam', 'Honorarios (contador, abogado)', 'Fees (accountant, lawyer)', 'otros'],

    ['emergencia', 'aho', 'Fondo de emergencia', 'Emergency fund', 'otros'],
    ['imprevistos', 'aho', 'Imprevistos del mes', 'Unexpected costs', 'otros'],

    ['cuotas', 'deu', 'Cuotas de tarjetas y préstamos', 'Card and loan payments', 'banco']
  ];

  const LIST = RAW.map(([id, g, es, en, cat]) => ({ id, g, es, en, cat }));
  const BY_ID = new Map(LIST.map((r) => [r.id, r]));
  const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

  const lang = () => (window.I18N && window.I18N.current && window.I18N.current() === 'en') ? 'en' : 'es';
  const nameOf = (item) => item[lang()] || item.es;

  return {
    groups: GROUPS,
    list: LIST,
    get: (id) => BY_ID.get(id) || null,
    group: (id) => GROUP_BY_ID.get(id) || null,
    isIncome: (id) => { const r = BY_ID.get(id); return !!r && r.g === 'ing'; },
    // Rubros de un grupo, en el orden de la plantilla.
    ofGroup: (g) => LIST.filter((r) => r.g === g),
    name: (id) => { const r = BY_ID.get(id); return r ? nameOf(r) : ''; },
    groupName: (id) => { const g = GROUP_BY_ID.get(id); return g ? nameOf(g) : ''; },
    // Categoría de la app que corresponde al rubro.
    catOf: (id) => { const r = BY_ID.get(id); return r ? r.cat : null; },
    // El rubro que representa las cuotas de deuda (se calcula desde Deudas).
    DEBT: 'cuotas'
  };
})();
