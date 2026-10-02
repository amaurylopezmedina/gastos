# Diseño: fotos → OCR + Ollama → app

**Estado (2026-10-02): construido y probado en local; falta desplegar el servicio nuevo y migrar los datos.**

> **Cambio de rumbo.** GitHub Pages se apagó. La app y los datos viven ahora en el servidor de casa:
> `gastos.iterakore.com` (todo detrás de Cloudflare Access) sirve la propia PWA y la API (`/api`) desde el
> mismo origen, así que ya no hay CORS ni service token en el navegador. Los datos de la app (gastos, deudas,
> presupuesto por rubros) son un estado JSON versionado en SQLite (`/api/estado`, se conservan las últimas 400
> versiones); este dispositivo guarda una copia local para abrir al instante y trabajar sin conexión
> (`sync.js`). Las secciones de abajo que hablan de «PWA en github.io» y del service token son del diseño
> anterior y quedan como historia. Concreta las fases 2 y 3 de `PLAN-DASHBOARD-LOCAL.md` con las
decisiones tomadas. No contiene datos personales: el subdominio, el correo de acceso y las
credenciales viven en `PRIVADO/`.

## Decisiones ya tomadas

- Máquina propia en casa (no VPS): los datos no salen de un disco del usuario.
- Acceso: **Cloudflare Tunnel + Cloudflare Access** (el dominio ya está en Cloudflare).
- Se empieza por las **fotos con IA**, con una base mínima; el panel completo llega después.
- Fotos de todo tipo: recibos térmicos, facturas con NCF y capturas del banco.
- RAM: se ampliará a 16-32 GB (módulos iguales, dual channel). Sin GPU.

## Flujo

```
PWA (iPhone) ── foto ──► Cloudflare Access ──► Tunnel ──► API local (127.0.0.1)
                                                               │
                                          OCR (RapidOCR) ──► texto con posiciones
                                                               │
                                          Ollama (modelo de texto) ──► JSON de campos
                                                               │
                                                    Verificador (código)
                                                  ┌────────────┴───────────┐
                                              cuadra                    dudoso
                                                  │                        │
                                         «listo para aplicar»        «por revisar»
                                                  └────────────┬───────────┘
PWA ◄── "Bandeja": lista, revisa y aplica ◄───────────────────┘
```

**La IA lee, el código comprueba.** El modelo nunca decide un importe por su cuenta:
- Las líneas deben sumar el subtotal y subtotal + impuestos = total, en céntimos enteros.
- El total que sale del modelo debe aparecer literalmente en el texto del OCR.
- Fecha válida y no futura; comercio no vacío.
- Si algo falla, o la confianza del OCR es baja, va a **por revisar**. Nada entra en silencio.
- Una corrección de categoría o comercio se guarda como regla y se aplica la próxima vez.

## Piezas

| Pieza | Elección | Nota |
| --- | --- | --- |
| API | FastAPI, solo `127.0.0.1` | Un proceso, servicio de systemd |
| Base | SQLite en `~/finanzas/` (fuera del repo) | facturas, lecturas, reglas, estado |
| Imágenes | `~/finanzas/facturas/` | Se conservan el original y la versión comprimida |
| OCR | RapidOCR (ONNX) o Tesseract | Rápido en CPU; se mide con facturas reales |
| Modelo | Ollama, texto ~3B con 11 GB; 7-8B con 24-32 GB | Solo `localhost`; salida JSON con esquema |
| Cola | Tabla `facturas.estado`: `nueva → leyendo → listo / revisar → aplicada / descartada` | Se procesa de una en una |

## Cómo llega a la app sin romper lo que ya funciona

La PWA sigue guardando todo en el teléfono. **No se hace sincronización bidireccional** en esta
fase, porque es donde nacen los duplicados y los conflictos. En su lugar:

1. La PWA sube la foto (`POST /facturas`) y consulta la **Bandeja** (`GET /facturas?estado=...`).
2. Al aplicar una factura, la PWA crea el gasto con **id fijo** (`f_<hash de la foto>`). La app ya
   ignora ids repetidos al importar: aplicar dos veces añade 0, como el flujo manual de hoy.
3. La foto va al gasto igual que ahora (IndexedDB).
4. Para el panel: más adelante la PWA enviará una copia de solo lectura de sus gastos al servidor
   (`PUT /instantanea`). El servidor nunca escribe en los datos del teléfono.

### Ingresos
Hoy un gasto es `{id, cents, cat, pay, date, note, photo, ts}` y no existe el ingreso. Hay que
añadir `kind:'expense'|'income'` (datos `v:4`, los existentes se tratan como `expense`), categorías
de ingreso, y que Resumen y presupuesto no mezclen ambos. **Es un cambio en la PWA y en la copia de
seguridad**, con migración y prueba de que una copia antigua se restaura igual.

### Duplicado con el estado de cuenta
Se mantiene la regla actual: un gasto apuntado (a mano o por foto) y luego el estado de la tarjeta
→ **Conciliar**, no Importar. La bandeja avisará cuando la forma de pago sea una tarjeta.

## Seguridad

1. **Access delante de todo.** Política: solo el correo del usuario. Nada del API es alcanzable
   sin pasar por Access.
2. **Problema conocido de la PWA instalada:** una petición `fetch` desde `github.io` a otro
   dominio recibe de Access una redirección a la página de login, y el navegador la bloquea
   (CORS); además iOS no comparte la sesión de Safari con la PWA instalada. Solución prevista:
   un **service token** de Access (`CF-Access-Client-Id` / `Secret`) que el usuario pega una vez
   en Ajustes y se guarda solo en el teléfono, nunca en el repo. Es revocable desde Cloudflare.
   **Esto se prueba primero**, con un endpoint de eco, antes de construir nada más.
3. CORS del API: solo el origen `https://amaurylopezmedina.github.io`.
4. Límites de subida: tipo MIME y tamaño máximos, nombres generados por el servidor, nunca el
   del cliente. Las imágenes se re-codifican (no se sirve nunca el archivo subido tal cual).
5. Ollama (11434) y el API solo en `127.0.0.1`. `cloudflared` apunta únicamente al API.
6. El prompt al modelo lleva el texto del OCR como **dato**, no como instrucciones: una factura
   con texto malicioso no debe poder dar órdenes. Por eso la salida es un JSON con esquema fijo y
   lo verifica el código.
7. Datos y credenciales fuera del repo (`~/finanzas`, `PRIVADO/`). El repo es público.
8. Cifrado de disco y copias de seguridad de `~/finanzas`: el usuario decide; hay que avisarle.

## Fases de construcción

| # | Qué | Se comprueba con |
| --- | --- | --- |
| 0 | **Prueba mínima:** API de eco + tunnel + Access + token, llamada desde la PWA instalada | Un iPhone real |
| 1 | API + SQLite + subida de foto + bandeja en la PWA (todavía sin IA: se teclea) | Subir y aplicar una foto |
| 2 | OCR + verificador + cola «por revisar» | Facturas de muestra inventadas, luego reales |
| 3 | Ollama: extracción de campos y categoría, reglas aprendidas | Medir aciertos por tipo de foto |
| 4 | Ingresos (`v:4`) y migración | Restaurar una copia antigua |
| 5 | Instantánea y panel «todo junto» | Cuadrar contra la app |

## Riesgos

- **Recibos térmicos:** el OCR falla más; la verificación y la cola de revisión son la defensa.
- **Máquina apagada o dormida:** la subida falla. La PWA debe guardar la foto y reintentar, y
  mostrar «pendiente de enviar». Desactivar la suspensión del equipo.
- **iOS y las PWA:** el almacenamiento puede borrarse si no se usa en semanas; la copia de
  seguridad regular sigue siendo obligatoria.
- **Mantenimiento:** `cloudflared`, Ollama y el modelo se actualizan; el servicio debe arrancar solo.
- Un modelo local no sustituye a una revisión humana de lo que entra en las cuentas.

## Preguntas abiertas

1. ¿Qué subdominio se usa? (va a `PRIVADO/`, no al repo)
2. ¿Dónde viven los datos? Propuesta: `~/finanzas/`.
3. ¿Qué correo entra por Access?
4. ¿Hay que migrar al servidor lo ya apuntado (octubre) o solo lo nuevo?
