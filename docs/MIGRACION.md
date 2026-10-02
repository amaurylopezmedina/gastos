# Migración a otra máquina — guion para Claude

Úsalo cuando el usuario diga que ha copiado o movido el proyecto y te pida reconectarlo con git.
Ejecuta los pasos en orden, comprueba cada resultado y no sigas si algo falla sin avisar.

## Lo que NO puedes hacer tú

**Autenticar GitHub.** `gh auth login` pide aprobar un código en el navegador con las
credenciales del usuario, y no debes introducirlas por él. Es el único paso manual. Dile:

> Ejecuta `gh auth login`, elige GitHub.com → HTTPS → "Login with a web browser", copia el código
> que sale, apruébalo en el navegador, y avísame.

Todo lo demás lo haces tú.

## Pasos

### 1. Mira dónde estás
```bash
pwd
git rev-parse --is-inside-work-tree
git remote -v
git status -sb
```
- Si hay `.git` y el remoto `origin` apunta a `https://github.com/amaurylopezmedina/gastos.git`:
  salta al paso 3.
- Si no hay `.git` (copiaron los archivos pero no la carpeta oculta): paso 2.

### 2. Reconecta sin perder nada (solo si falta `.git` o el remoto)
```bash
git init -b main
git remote add origin https://github.com/amaurylopezmedina/gastos.git
git fetch origin
git reset origin/main          # mixed: mueve la rama pero NO toca los archivos
git branch --set-upstream-to=origin/main main
git status -sb
```
- **Nunca** `git reset --hard`, `git clean`, ni `push --force`.
- Mira el `git status`: si la copia difiere del remoto, enséñale al usuario las diferencias y
  pregúntale cuál manda antes de tocar nada. Lo esperable es "nada que commitear" (el repo estaba
  sin cambios pendientes al copiar) o solo cambios de archivos de esta carpeta.
- Si el remoto ya existía pero con otra URL: `git remote set-url origin <la de arriba>`.

### 3. Autenticación y credenciales
```bash
gh --version
gh auth status
```
- Si no hay sesión, pide al usuario que haga `gh auth login` (arriba). Luego:
```bash
gh auth setup-git      # hace que git use las credenciales de gh
gh auth status
```
- Si `gh` no está instalado: Windows `winget install GitHub.cli`; macOS `brew install gh`;
  Linux, el gestor de paquetes. Instalar herramientas es normal; confirma con el usuario si
  hace falta elevar permisos.

### 4. Identidad de git — decídelo con el usuario, no lo inventes
```bash
git config user.name
git config user.email
```
**Aviso heredado:** los commits hechos hasta ahora están firmados con la identidad global de la
máquina original, que no era necesariamente la que el usuario quiere mostrar, y son **públicos**
en el historial (míralo con `git log -3 --format='%an <%ae>'`; el detalle está en
`PRIVADO/CONTEXTO-FINANCIERO.md`, sección 8).
Pregúntale al usuario con qué nombre y correo quiere firmar de ahora en adelante y configúralo
solo para este repo (`git config user.name ...` sin `--global`). Si prefiere no exponer un correo,
GitHub ofrece uno `…@users.noreply.github.com`. **No reescribas el historial** (`rebase`,
`filter-repo`) sin que lo pida explícitamente: es destructivo y obliga a un push forzado.

### 5. Comprueba que está sincronizado
```bash
git fetch origin
git status -sb
git log --oneline origin/main..HEAD   # vacío = no hay nada sin subir
git log --oneline HEAD..origin/main   # vacío = no te falta nada
```

### 6. GitHub Pages — no hay nada que rehacer
La configuración vive en GitHub, no en la máquina. Solo verifica:
```bash
gh api repos/amaurylopezmedina/gastos/pages --jq '{url: .html_url, estado: .status, rama: .source.branch}'
gh api repos/amaurylopezmedina/gastos/pages/builds/latest --jq '{estado: .status, commit: .commit}'
```
Debe salir `built` y `https://amaurylopezmedina.github.io/gastos/`.

### 7. Herramientas locales
```bash
python --version        # o python3 · 3.10 o superior
node --version          # opcional
```
- Servidor de pruebas: `python3 -m http.server 5190 --bind 127.0.0.1` (config `gastos` en `.claude/launch.json`).
- Para los scripts de `PRIVADO/scripts/`: `pip install pypdf openpyxl reportlab`.

### 8. ¿Llegó la zona privada?
```bash
ls PRIVADO
python PRIVADO/scripts/manifiesto.py --verificar
```
- La segunda línea compara cada archivo con su huella SHA-256: dice si falta algo o llegó alterado.
  `OK: los N archivos del manifiesto estan y son identicos` = la copia está íntegra. Una línea
  `NUEVO` no es un error (es trabajo hecho después de copiar). `FALTA`/`DISTINTO` sí: avísale.
  Necesita Python 3.8+ y nada más (solo la librería estándar).
- Si existe `PRIVADO/CONTEXTO-FINANCIERO.md`: léelo entero antes de seguir con deudas o presupuesto;
  la sección 0 es el estado exacto en que se hizo la copia.
- Si **no existe**: el usuario copió el repo con git (que la ignora). No pasa nada con la app, pero
  has perdido el contexto financiero. Díselo con claridad y pídele que copie esa carpeta desde la
  máquina anterior; no intentes reconstruirla de memoria ni de preguntas sueltas.

### 9. Prueba de humo
1. Arranca el servidor de pruebas y abre `http://127.0.0.1:5190`.
2. Consola sin errores; en **Ajustes** abajo debe leerse `Gastos · v17` (o la versión vigente,
   que es el `CACHE` de `sw.js`).
3. Comprueba que `git status` está limpio y que **no** aparece `PRIVADO/`.

### 10. Informa
Resume al usuario: remoto, rama, estado de sincronización, identidad de commits, si Pages está
`built`, si llegó `PRIVADO/`, y qué dejaste pendiente (por ejemplo, la identidad).

## Si la máquina nueva es un servidor expuesto con Cloudflare

Es probable (el usuario lo mencionó). **Antes de exponer nada** lee `docs/PLAN-DASHBOARD-LOCAL.md`,
sección "Seguridad". Resumen no negociable:

- La PWA es estática y no contiene datos: no hay riesgo en publicarla.
- Un panel con datos bancarios **jamás** se expone solo por un túnel. Va detrás de **Cloudflare
  Access** limitado al correo del usuario, escuchando en `localhost`.
- Ollama (puerto 11434) no tiene autenticación: **solo `localhost`**, nunca por el túnel.
- Pregunta si es una máquina propia o un VPS alquilado: en un VPS los estados de cuenta
  quedarían en el disco de un tercero.
- Pregunta por la GPU. Sin ella, los modelos locales son mucho más lentos.

## Qué conviene que el usuario sepa antes de mover

- **No cambiar la URL de la PWA.** Los datos del iPhone están atados a ese origen.
- Los estados de cuenta originales **no** están en el proyecto; siguen en la carpeta de descargas
  de la máquina antigua.
- Si copia la carpeta con una nube sincronizada (OneDrive, iCloud, Dropbox) o la comprime,
  `PRIVADO/` va dentro: tratarla como datos sensibles.
