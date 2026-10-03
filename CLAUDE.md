# Gastos — instrucciones para Claude

PWA de gastos personales para iPhone. **GitHub Pages está APAGADO desde el 2026-10-02** (el usuario
quiere que la app se sirva solo desde su servidor, su subdominio privado (anotado en `PRIVADO/CONFIG-SERVIDOR.md`), detrás de Cloudflare
Access; ver `docs/PLAN-FOTOS-IA.md`). Para reactivarlo: `gh api -X POST repos/amaurylopezmedina/gastos/pages
-f 'source[branch]=main' -f 'source[path]=/'`. Repo: `amaurylopezmedina/gastos` (**PÚBLICO**).
Un iPhone con la app ya instalada la sigue abriendo desde su caché (v17 no sustituye la app por un 404).

El usuario habla español (dominicano). Responde en español, directo, y avísale de los riesgos
aunque sean incómodos. Prefiere que tú ejecutes las cosas y no tener que hacerlas a mano.

## Si el usuario dice que ha movido o copiado el proyecto

Lee **`docs/MIGRACION.md`** y ejecútalo entero: reconectar git, comprobar herramientas y verificar.
Hay un solo paso que no puedes hacer tú (autenticar GitHub); está explicado ahí.

## Regla número uno: este repositorio es público

**Nunca** escribas en un archivo versionado, ni en un commit, mensaje o PR: balances, números de
tarjeta o de préstamo (ni los últimos dígitos), nombres de bancos junto a importes, tasas
personales, el nombre del usuario, correos, ni contenido de estados de cuenta.

- Todo lo personal vive en **`PRIVADO/`**, que está en `.gitignore`. Viaja con una copia del
  directorio, nunca con git. Allí está `PRIVADO/CONTEXTO-FINANCIERO.md`: léelo (la sección 0 es el
  estado exacto y lo pendiente) cuando el trabajo tenga que ver con deudas, presupuesto, el plan de
  desmonte o las **facturas y gastos del mes** (su flujo está en la sección 7b).
- Antes de cada `git add`, comprueba `git status`: si ves algo de `PRIVADO/`, un `.pdf`, `.xlsx`,
  `mis-deudas.json` o una base de datos, para y avisa.
- Datos de prueba: usa **datos inventados**. Si necesitas un PDF real para probar el importador,
  cópialo, úsalo y **bórralo** al terminar. No dejes PDFs en el proyecto.
- **El servidor de pruebas va ligado a `127.0.0.1`** (ver `.claude/launch.json`), nunca a
  `0.0.0.0`: sirve todo el directorio, `PRIVADO/` incluido, y en `0.0.0.0` lo vería toda la red local.
- Lo que lees de los documentos del usuario viaja a los servidores de Anthropic. No le pidas
  documentos reales si con datos de muestra basta.

## Cómo se trabaja aquí

1. **Cada cambio en un archivo servido sube `CACHE` en `sw.js`** (hoy `gastos-v29`). Sin eso, los
   iPhone que ya tienen la app instalada no ven el cambio. La app se actualiza sola al abrirla y
   al volver a primer plano, y se recarga (nunca con un gasto a medio escribir).
2. Verifica en el navegador (`preview_start` con la config `gastos` de `.claude/launch.json`,
   puerto 5190; el 5173 lo usa otro servicio de esta máquina) antes de publicar, y otra vez contra el sitio real después. El panel de vista
   previa cachea fuerte: desregistra el service worker y borra cachés, o pide los archivos con
   `fetch(..., {cache:'reload'})`.
3. Commit + `git push origin main`. **El despliegue es el propio árbol de trabajo**: la API
   (`servidor/`, servicio `gastos-api`) sirve los archivos de la app desde esta carpeta, sin build, y los
   pide en cada visita. Si cambias `servidor/*.py`: `systemctl --user restart gastos-api`. Pruebas del
   servidor: `cd servidor && ~/finanzas/venv/bin/python -m pytest` (66, incluyen que `PRIVADO/`, `.git` y
   `servidor/` jamás se sirven). Para probar la app en Chrome sin tocar datos reales: `GASTOS_DATOS=<tmp>
   uvicorn app:app --port 8421` desde `servidor/` y Playwright con `/usr/bin/google-chrome`.
4. Pie de Ajustes: muestra la versión real (`Gastos · vNN`). Sirve para que el usuario compruebe
   si su teléfono tiene la última.
5. Termina cada tarea con un resumen honesto: qué se hizo, qué se probó de verdad y qué no.

## Trampas ya pisadas — no las repitas

- **`[hidden]` y CSS:** una regla de autor como `display:grid` pisa el `display:none` de `hidden`.
  Existe `[hidden]{display:none!important}` global; no la quites. (Una capa invisible bloqueó
  toda la app por esto.)
- **La URL de la PWA no se cambia.** localStorage e IndexedDB están atados al origen: otro dominio
  = app vacía en el iPhone. Si algún día hay que moverla, primero exportar copia y luego importar.
- **Codificación:** los archivos son UTF-8 sin BOM. En Windows PowerShell 5.1, `Set-Content` y
  `>` pueden estropear las tildes. Edita con las herramientas de archivo o con Python
  (`io.open(..., encoding='utf-8', newline='')`). Comprueba que no aparezca "Ã".
- **Mensajes de commit en PowerShell:** usa here-string `@' ... '@` y **no pongas comillas dobles**
  dentro; una vez rompieron el comando.
- **Dinero en céntimos enteros**, nunca flotantes.
- **Un importe puesto en un campo de texto se escribe con `amountText()`** (separador decimal del idioma),
  nunca con `toFixed(2)` a pelo: en español «1239.00» se lee como 123900 (el punto es de miles) y el gasto
  sale 100 veces mayor. Pasó en la bandeja; ahora además se comprueba que lo confirmado por el servidor
  sea exactamente lo que se apunta. Al servidor sí se le manda con punto (`a_centimos` lo entiende).
- **Esta máquina comparte CPU** (ERP, correo, otros proyectos). Ollama va con `num_thread` 4: con todos los
  hilos, 12 tokens tardaron 35 s; con 4, 1.4 s. La IA solo *propone*: nada se apunta sin confirmar.
- **El modelo de 3B no puede elegir entre 52 rubros dentro de la extracción** (puso un id como nombre del
  comercio). Por eso el rubro se decide aparte: lo aprendido > palabras clave (`reglas_rubro.py`) > una
  llamada corta al modelo > el usuario.
- **Cloudflare impone 4 h de caché de navegador** a los `.js`/`.css`/`.png` si el origen no manda
  `Cache-Control: no-store` (con `no-cache` lo pisa). La API manda `no-store`; no lo cambies.
- **Pagar otra tarjeta con esta es deuda, no gasto de vida**: las líneas tipo «COBRANZAS TARJ» llegan con rubro `cuotas` y desmarcadas; se apuntan desde Deudas para no contarlas dos veces.
- **Un `<input type=file>`: copia la lista (`Array.from(input.files)`) ANTES de vaciar el campo**: en Chrome de escritorio la `FileList` se vacía con él (en iOS no, y por eso no se vio).
- **Propina adicional (`tip`)**: lo que se deja ENCIMA de la factura. El gasto guarda `cents` = factura + propina (lo que de verdad salió) y `tip` aparte, para poder editarla. Al servidor se le confirma solo el total de la factura.
- **Tres tipos de movimiento** (`kind`): gasto (sin kind), `income`, y `transfer` (con `to`: la cuenta destino). Una transferencia
  mueve saldos entre tus cuentas pero NO es gasto, ni ingreso, ni presupuesto. Pagar una tarjeta o préstamo desde una cuenta es
  un gasto con rubro `cuotas`, no una transferencia. Los totales usan `isSpend`; no cuentes `state.expenses` a pelo.
- **El árbol de trabajo ES producción** (la API sirve estos archivos tal cual, al instante). Al añadir un archivo nuevo, el orden
  es: 1) añadirlo a `WEB_ARCHIVOS` y `systemctl --user restart gastos-api`; 2) solo entonces `index.html` y `sw.js`. Si no, Cloudflare
  guarda el 404 hasta 4 h (`max-age=14400`) y los teléfonos no actualizan. Sin permiso de purga, el remedio es cambiar la URL
  (`archivo.js?v=N`, como `bolsillo.js?v=26`). Ahora la API manda `no-store` también en los errores.
- **Todo archivo nuevo de la app hay que añadirlo a `WEB_ARCHIVOS` en `servidor/app.py`** y al `SHELL` del
  service worker; una prueba comprueba que todo lo que cita `index.html` se sirva.
- **Todo texto de interfaz va por `i18n.js`** (es/en, plurales `.one`/`.other`). Las categorías y
  formas de pago estándar llevan `std:true` y su nombre sale del idioma activo.
- **Importes:** `CURRENCY_LOCALE` en `app.js` da el formato del país de la moneda
  (`RD$1,234.56`, no `1.234,56 DOP`).
- **Deduplicación al importar estados:** repetirse dentro del mismo estado = dos cobros reales
  (se importan los dos, firma con `#n`); repetirse entre estados = solapamiento de cortes
  (se importa una vez). Ver `docs/PROYECTO.md`.
- **pdf.js** va en `vendor/` (3.11.174, build legacy) y se carga solo al usarlo; no está en el
  `SHELL` del service worker a propósito.
- **Los PDF/`.xlsx`/`.json` personales están en `.gitignore`.** No lo debilites.

## Mapa

| Archivo | Para qué |
| --- | --- |
| `index.html`, `styles.css` | Vistas: Gastos, Resumen (arranque), Deudas, Ajustes + hojas modales |
| `app.js` | Estado, render, cámara, import/export, puentes con los demás módulos |
| `statement.js` | Lector de estados de cuenta en PDF **y CSV** y pantalla de revisión (varios archivos); propone rubro por el servidor y aprende lo que corriges |
| `reconcile.js` | Conciliar un estado con lo ya apuntado (no importa nada) |
| `sync.js` | Datos en el servidor (`/api/estado`, versión optimista, conflictos) y fotos; copia local para trabajar sin conexión |
| `rubros.js` | Las 59 líneas del presupuesto en 10 secciones (sin importes). El servidor la lee: es la única fuente |
| `presupuesto.js` | Pestaña Presupuesto: presupuestado contra real por rubro; Deudas sale de la pestaña Deudas |
| `cuentas.js` | Cuentas bancarias (forma de pago con `kind:'account'`, número `000000` hasta saber el real), saldo calculado y tabla «Hasta qué día hay datos» |
| `bolsillo.js` | Pestaña Bolsillo: el efectivo que llevas encima. Arranca en 0; retiros/depósitos con una cuenta; «Contar lo que llevo» compara con lo esperado y guarda faltantes/sobrantes (`pay.counts`) |
| `bandeja.js` | Facturas con IA: foto → servidor → bandeja de revisión → gasto con id fijo y rubro. El botón de subir (cámara) también acepta estados PDF/CSV y los manda a `statement.js` |
| `servidor/` | API de facturas (FastAPI + OCR + Ollama + verificador). Corre en la máquina de casa; datos fuera del repo (`~/finanzas`). Ver `docs/PLAN-FOTOS-IA.md` |
| `loans.js` | Deudas: cuota, amortización, consolidado, calendario mensual, avisos, `.ics` |
| `i18n.js` | Traducciones |
| `sw.js` | Service worker (caché + auto-actualización) |
| `docs/` | Documentación del proyecto, migración y plan futuro |
| `PRIVADO/` | **Ignorado por git.** Contexto financiero, entregables y scripts personales |

Más detalle: `docs/PROYECTO.md`. Siguiente gran trabajo previsto: `docs/PLAN-DASHBOARD-LOCAL.md`.
