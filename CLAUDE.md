# Gastos — instrucciones para Claude

PWA de gastos personales para iPhone, sin build, sin servidor. Publicada en GitHub Pages:
https://amaurylopezmedina.github.io/gastos/ · repo: `amaurylopezmedina/gastos` (**PÚBLICO**).

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

1. **Cada cambio en un archivo servido sube `CACHE` en `sw.js`** (hoy `gastos-v16`). Sin eso, los
   iPhone que ya tienen la app instalada no ven el cambio. La app se actualiza sola al abrirla y
   al volver a primer plano, y se recarga (nunca con un gasto a medio escribir).
2. Verifica en el navegador (`preview_start` con la config `gastos` de `.claude/launch.json`,
   puerto 5190; el 5173 lo usa otro servicio de esta máquina) antes de publicar, y otra vez contra el sitio real después. El panel de vista
   previa cachea fuerte: desregistra el service worker y borra cachés, o pide los archivos con
   `fetch(..., {cache:'reload'})`.
3. Commit + `git push origin main`. Pages tarda ~1 minuto; espera a que
   `gh api repos/amaurylopezmedina/gastos/pages/builds/latest` diga `built` con tu commit.
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
| `statement.js` | Lector de estados de cuenta en PDF y pantalla de revisión (varios archivos) |
| `reconcile.js` | Conciliar un estado con lo ya apuntado (no importa nada) |
| `bandeja.js` | Facturas con IA: sube fotos al servidor de casa, bandeja de revisión, aplica gastos con id fijo |
| `servidor/` | API de facturas (FastAPI + OCR + Ollama + verificador). Corre en la máquina de casa; datos fuera del repo (`~/finanzas`). Ver `docs/PLAN-FOTOS-IA.md` |
| `loans.js` | Deudas: cuota, amortización, consolidado, calendario mensual, avisos, `.ics` |
| `i18n.js` | Traducciones |
| `sw.js` | Service worker (caché + auto-actualización) |
| `docs/` | Documentación del proyecto, migración y plan futuro |
| `PRIVADO/` | **Ignorado por git.** Contexto financiero, entregables y scripts personales |

Más detalle: `docs/PROYECTO.md`. Siguiente gran trabajo previsto: `docs/PLAN-DASHBOARD-LOCAL.md`.
