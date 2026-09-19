# Gastos

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
- **Copias de seguridad**: exportar/importar JSON (incluye las fotos) y exportar CSV.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Estructura de las tres vistas y la hoja de alta/edición |
| `styles.css` | Estilos, modo claro/oscuro y márgenes seguros del iPhone |
| `app.js` | Lógica: estado, render, cámara, import/export |
| `i18n.js` | Traducciones (`es`, `en`) |
| `sw.js` | Service worker: caché del app shell para uso sin conexión |
| `manifest.webmanifest` | Nombre, iconos y modo standalone |
| `icons/` | Iconos PNG (incluido `apple-touch-icon.png`) |

## Probar en el PC

```bash
python -m http.server 5173
```

Y abre `http://localhost:5173`.

## Publicar

iOS solo instala una PWA en la pantalla de inicio si se sirve por **HTTPS**.
Cualquiera de estas opciones vale y es gratis:

- **Netlify Drop**: arrastra la carpeta a <https://app.netlify.com/drop>.
- **GitHub Pages**: sube la carpeta a un repositorio y activa Pages en Settings.
- **Vercel**: `npx vercel --prod` dentro de la carpeta.

No hay paso de compilación: se publican los archivos tal cual.

## Instalar en el iPhone

1. Abre la URL en **Safari** (no sirve Chrome en iOS para instalar).
2. Botón **Compartir** → **Añadir a pantalla de inicio**.
3. Ábrela desde el icono: se ve a pantalla completa y funciona sin conexión.

## Publicar cambios

Al tocar cualquier archivo, sube el número de `CACHE` en `sw.js`
(`gastos-v2` → `gastos-v3`). Sin eso, los iPhone que ya tengan la app instalada
seguirán usando la versión guardada en caché.

## Dónde se guardan los datos

- Gastos, categorías y formas de pago: `localStorage`.
- Fotos de facturas: `IndexedDB` (comprimidas a 1600 px / JPEG 72 %).

Todo es local a ese navegador y ese dispositivo; no se sincroniza entre
teléfonos. Si borras los datos del sitio o desinstalas la app, se pierden:
usa **Ajustes → Exportar copia de seguridad** de vez en cuando y guarda el JSON
en Archivos o iCloud.
