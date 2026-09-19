# Gastos

**En vivo: <https://amaurylopezmedina.github.io/gastos/>**

PWA para llevar los gastos personales desde el iPhone. Sin cuentas, sin servidor
y sin conexión: los datos viven en el propio teléfono.

- **Apuntar rápido**: teclado numérico propio, categoría, forma de pago, fecha y nota.
- **Foto de la factura**: la tomas con la cámara, la app la comprime y la guarda
  asociada al gasto. Toca la miniatura para verla a pantalla completa.
- **Formas de pago**: efectivo, tarjeta, transferencia y las que añadas (cada
  tarjeta o cuenta por su nombre). En *Resumen* ves cuánto debe cada una este mes.
- **Resumen**: total, media diaria, comparación con el mes anterior, desglose por
  categoría y por forma de pago, y barras de los últimos 6 meses.
- **Presupuesto mensual** opcional con barra de progreso.
- **Español e inglés**, con el idioma del sistema detectado automáticamente.
- **Importar el estado de cuenta del banco (PDF)**: lee los movimientos, propone
  categoría para cada uno, deja fuera los pagos a la tarjeta y lo ya importado,
  y crea la forma de pago con los últimos dígitos de la tarjeta. El PDF se lee
  en el propio teléfono con `pdf.js` servido desde este sitio: **no se sube a
  ningún servidor**.
- **Deudas**: préstamos y tarjetas con balance, tasa anual, plazo y día de pago.
  Calcula la cuota (sistema francés), el consolidado de lo que debes, cuánto
  toca pagar al mes y un calendario de los próximos pagos. Al registrar una
  cuota, la apunta como gasto y descuenta del balance el capital amortizado.
- **Copias de seguridad**: exportar/importar JSON (incluye las fotos) y exportar CSV.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Estructura de las tres vistas y la hoja de alta/edición |
| `styles.css` | Estilos, modo claro/oscuro y márgenes seguros del iPhone |
| `app.js` | Lógica: estado, render, cámara, import/export |
| `statement.js` | Lectura del estado de cuenta en PDF y pantalla de revisión |
| `loans.js` | Deudas: cuotas, amortización, consolidado y calendario |
| `i18n.js` | Traducciones (`es`, `en`) |
| `vendor/` | `pdf.js`, servido desde el propio sitio (no hay CDN de terceros) |
| `sw.js` | Service worker: caché del app shell para uso sin conexión |
| `manifest.webmanifest` | Nombre, iconos y modo standalone |
| `icons/` | Iconos PNG (incluido `apple-touch-icon.png`) |

## Probar en el PC

```bash
python -m http.server 5173
```

Y abre `http://localhost:5173`.

## Instalar en el iPhone

1. Abre <https://amaurylopezmedina.github.io/gastos/> en **Safari**
   (desde Chrome en iOS no se puede instalar).
2. Botón **Compartir** → **Añadir a pantalla de inicio**.
3. Ábrela desde el icono: se ve a pantalla completa y funciona sin conexión.

## Publicar cambios

El sitio se sirve con GitHub Pages desde la rama `main`, sin compilación:

```bash
git add -A
git commit -m "..."
git push
```

En un minuto está publicado. **Antes de cada push que toque un archivo del
front, sube el número de `CACHE` en `sw.js`** (`gastos-v7` → `gastos-v8`): es
lo que le dice al service worker que hay una versión nueva.

Los dispositivos con la app instalada se actualizan solos: al abrirla y cada
vez que vuelve a primer plano, busca una versión nueva y, si la encuentra, la
instala y recarga (nunca con un gasto a medio escribir). No hace falta cerrar
la app ni reinstalarla.

## Dónde se guardan los datos

- Gastos, categorías y formas de pago: `localStorage`.
- Fotos de facturas: `IndexedDB` (comprimidas a 1600 px / JPEG 72 %).

Todo es local a ese navegador y ese dispositivo; no se sincroniza entre
teléfonos. Si borras los datos del sitio o desinstalas la app, se pierden:
usa **Ajustes → Exportar copia de seguridad** de vez en cuando y guarda el JSON
en Archivos o iCloud.
