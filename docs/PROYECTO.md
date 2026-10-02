# Gastos — cómo está hecho y por qué

Documento técnico para quien (o lo que) retome el proyecto. No contiene datos personales.

## Qué es

PWA para llevar gastos personales desde el iPhone. Sin cuentas, sin servidor, sin build: HTML, CSS
y JavaScript. Funciona sin conexión y los datos viven en el teléfono.

Vistas: **Gastos** (lista por mes) · **Resumen** (pantalla de arranque) · **Deudas** · **Ajustes**.
Hojas modales: alta/edición de gasto, deuda, importar estado de cuenta, conciliar.

## Datos

- `localStorage['gastos.v1']`, JSON con `v:3`: `lang`, `currency`, `budget`, `cats`, `pays`,
  `expenses`, `debts`, `imports`.
- Fotos de facturas en **IndexedDB** `gastos-fotos` (store `photos`), comprimidas a 1600 px JPEG 72 %.
- Importes en **céntimos enteros**.
- Gasto: `{id, cents, cat, pay, date:'YYYY-MM-DD', note, photo, ts}` y, si viene de un PDF o de una
  cuota, `sig`, `src:'pdf'|'debt'`, `batch`.
- Deuda: `{id, name, kind:'card'|'loan', principal, balance, rate, term, payment, dueDay, pay, paid[], cat}`.
- Carga (`imports`): `{id, file, when, count, cents}`. Cada gasto importado lleva su `batch`, así se
  puede deshacer una carga entera.
- La copia de seguridad JSON (Ajustes) contiene todo lo anterior más las fotos en base64, y la
  importación restaura gastos, categorías, formas de pago, deudas, cargas y fotos. Un archivo que
  solo traiga deudas también vale; las deudas se comparan por `id` **y por nombre**.

## Módulos

| Módulo | Responsabilidad |
| --- | --- |
| `app.js` | Estado, render, hoja de gasto, cámara, exportar/importar, navegación, puentes (`window.X.init({...})`) |
| `statement.js` | `readPdf`, `parseFiles` (lectura sin interfaz, varios archivos), pantalla de revisión |
| `reconcile.js` | Compara un estado con lo apuntado: cuadran / faltan / sobran |
| `loans.js` | Cuota francesa, reparto interés/capital, calendario, avisos, exportar `.ics` |
| `i18n.js` | `I18N.t`, `I18N.tn` (plural), `apply` sobre `data-i18n*` |

Los módulos no tocan el estado directamente: reciben un "puente" con funciones desde `app.js`.

## Decisiones y su razón

**Lectura de estados de cuenta.** El texto plano de un PDF no distingue un consumo de un pago:
ambos son "fecha, concepto, número". Lo que los distingue es la **columna**. pdf.js da la posición
de cada fragmento, y los créditos caen más a la derecha. Se agrupan los fragmentos en líneas por su
coordenada vertical (tolerancia 3) y se usa la X derecha del importe.

**El PDF nunca sale del teléfono.** pdf.js está servido desde el propio sitio (`vendor/`), sin CDN,
y se carga solo al usarlo. No está en el `SHELL` del service worker (pesa 1,5 MB).

**Deduplicación.** Firma = `fecha|céntimos|primeros 24 caracteres del concepto`. Repetirse significa
cosas distintas:
- dentro del mismo archivo → dos cobros reales: la 2ª ocurrencia lleva sufijo `#2` y se importa;
- entre archivos → es el solapamiento de los cortes de mes: se descarta.
Por eso `parseFiles` cuenta repeticiones por archivo y acumula lo visto entre archivos.

**Conciliación.** Una firma exacta solo funciona con lo que salió del propio PDF; un gasto escrito
a mano dice "Súper" donde el banco dice "SUPERMERCADO EJEMPLO CIUDAD-DO", y la fecha baila. Primero firma;
si no, **mismo importe con hasta 4 días de margen**, prefiriendo el día más cercano. Se compara
contra una forma de pago concreta (por defecto la tarjeta del estado). Los pagos a la tarjeta no
cuentan como gasto.

**Pagos a tarjeta vs gastos.** Se importan solo los consumos; los créditos quedan desmarcados.

**Resumen de estados del BHD sin etiquetas.** En esos PDF las cifras de cabecera (saldo anterior,
pagos, consumos, balance, pago mínimo) son números sueltos: la plantilla pone los rótulos como
imagen. No se adivinan por posición. Se **verifican por aritmética**: `anterior − pagos + consumos =
balance`. Las tasas sí vienen como texto (sección "TASA FINANC. ANUAL"). Los de Scotiabank traen
etiquetas completas, incluido el detalle de cada plan de cuotas.

**Recordatorios.** Una PWA no puede programar notificaciones con la app cerrada en iOS sin un
servidor que las empuje. Alternativa honesta: al abrir la app avisa de lo que vence en 3 días o
ya venció, y se exporta un `.ics` (evento mensual por deuda con alarma el día antes) al calendario
del teléfono, que sí avisa solo.

**Deudas.** Cuota por sistema francés. Si la cuota no cubre el interés mensual, la app lo dice
("la cuota no cubre los intereses"). Registrar un pago crea el gasto y baja el balance solo por el
capital amortizado.

**Formato de importes.** `CURRENCY_LOCALE` mapea moneda → locale del país (DOP → es-DO) si habla el
idioma elegido; si no, manda el idioma de la app. Moneda por defecto en datos nuevos: EUR; la lista
incluye DOP.

**Auto-actualización.** Al abrir y al volver a primer plano se llama a `registration.update()`. Cuando
el service worker nuevo toma el control, la página se recarga, salvo en la primera instalación o con
la hoja de un gasto abierta. El pie de Ajustes lee el nombre de la caché activa para mostrar la versión.

## Historial resumido

1. PWA base: teclado numérico propio, categorías, resumen, presupuesto, copia JSON/CSV, es/en.
2. Foto de factura asociada al gasto; formas de pago; "a pagar por método" en el resumen.
3. Publicada en GitHub Pages; arranque en Resumen; auto-actualización; corrección de la capa
   `[hidden]` que bloqueaba toda la pantalla.
4. Importar estados de cuenta (PDF), deshacer cargas, varios estados a la vez, ofrecer la tarjeta
   como deuda.
5. Deudas: consolidado por tipo, calendario mensual, avisos, `.ics`.
6. Conciliación, restauración de deudas desde la copia, versión visible en Ajustes.

## Verificar un cambio

```bash
python -m http.server 5173        # o preview_start "gastos"
```
En el panel de vista previa: desregistra el service worker, borra `caches`, recarga. Prueba el flujo
real, no solo que no haya errores de consola. Tras publicar, repite contra el sitio en vivo.

## Lo que falta o es frágil

- No hay pruebas automáticas; se verifica a mano en el navegador.
- Un solo idioma de importes por vez; los saldos en otra moneda se convierten con una tasa que
  introduce el usuario.
- La clasificación por comercio es una lista de expresiones regulares pensada para República
  Dominicana; lo que no encaja cae en "Otros" y se corrige en la pantalla de revisión.
- El lector de PDF depende de que el banco mantenga el formato.
