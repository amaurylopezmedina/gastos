# Plan: dashboard local con IA local

**Estado: propuesto, sin construir.** El usuario pidió una sugerencia y quiere ver las opciones
antes de empezar. No construyas nada de esto sin que lo confirme y sin resolver las decisiones
abiertas de abajo.

## Objetivo

Que facturas y estados de cuenta se procesen solos y alimenten un panel, sin digitar nada:

> suelta el archivo → se lee → se comprueba → entra en la base → aparece en el dashboard

## Idea central

**La IA lee; el código comprueba.** Los modelos pequeños se equivocan al sumar y al leer cifras.
Lo que da seguridad es una comprobación aritmética hecha por código. Reparto:

| Tarea | Quién |
| --- | --- |
| Leer estados de cuenta en PDF | Código determinista (los lectores de `statement.js`, portados) |
| Leer fotos de facturas | OCR (Tesseract/PaddleOCR/RapidOCR) + modelo local que ordena los campos; modelo de visión solo como respaldo |
| Clasificar comercios nuevos | Modelo local |
| Sumas, cuadres, calendario, intereses | Código |
| Preguntas en lenguaje natural | Modelo local, **solo lectura** sobre la base |

## Arquitectura

```
iPhone (foto) ─┐
Descargas      ├─► Carpeta «bandeja» ─► Vigilante ─► Extractor ─► Verificador
PDF del banco ─┘                                                      │
                                                          ┌───────────┴──────────┐
                                                     cuadra                  dudoso
                                                          │                      │
                                                          ▼                      ▼
                                                  Base SQLite  ◄──────  Cola «por revisar»
                                                          │
                                                          ▼
                                                Dashboard local (navegador)
```

- **Una base SQLite** (un archivo): gastos, deudas, estados, facturas con su imagen, reglas de
  categoría. Reutiliza el modelo de `docs/PROYECTO.md` y la firma anti-duplicados.
- **Nada entra en silencio si hay duda.** Lo que no cuadra o el modelo duda va a "por revisar".
- **Aprende de las correcciones:** una corrección de categoría se guarda como regla.
- **Dashboard:** FastAPI + una página estática (la misma estética que la PWA) es lo más simple;
  Streamlit sirve para un primer borrador. Reutiliza deudas, calendario, plan de desmonte,
  presupuesto contra real y seguimiento mensual.
- **Los datos viven fuera del repo** (p. ej. `C:\Finanzas` o `~/finanzas`), nunca dentro de
  este directorio versionado.

## Hardware conocido (máquina original)

i7-12700H, 31,7 GB RAM, RTX 3060 Laptop (Windows reporta 4 GB de VRAM, pero ese campo se satura
en 4 GB; la 3060 Laptop suele tener 6 GB: confirmar con `nvidia-smi`). Con 6 GB de VRAM y 32 GB de
RAM corren bien modelos de ~7-8B cuantizados; los de 14B van parcialmente en RAM y más lentos.
Para procesar facturas en lote es suficiente. **Ollama no estaba instalado.** Si la máquina nueva
es otra, repite esta comprobación: cambia la elección de modelos.

## Cómo llegan las fotos del iPhone al PC

1. **Tailscale + página de subida** (recomendado): red privada, nada expuesto a internet.
2. iCloud para Windows: un álbum "Facturas" sincroniza a una carpeta.
3. Atajo de iOS: botón "compartir" que manda la foto a la bandeja.

## Seguridad — no negociable

El panel contendrá el historial bancario completo.

1. **Un túnel sin autenticación es una URL pública a esos datos.** Que nadie conozca la dirección
   no es seguridad.
2. Si se usa **Cloudflare Tunnel**: sin abrir puertos en el router; **Cloudflare Access** delante
   del panel con política que solo admita el correo del usuario (código por email o login de
   Google); el panel escuchando solo en `localhost`.
3. **Ollama (11434) y la base de datos solo en `localhost`**, jamás por el túnel. Ollama no tiene
   autenticación: expuesto sería un modelo abierto a cualquiera.
4. Cloudflare descifra el tráfico en sus servidores antes de entregarlo. No es grave, pero es un
   tercero en medio. **Tailscale** no tiene ese paso y para uso personal es más simple y no expone
   nada; Cloudflare tiene sentido si hace falta una dirección pública estable.
5. **VPS alquilado:** los estados de cuenta quedarían en el disco de otra empresa, lo que anula
   buena parte de la ventaja de la IA local. Preguntarlo antes.
6. Este repositorio es público: ni la base, ni los PDF, ni las facturas, ni `PRIVADO/` entran en él.

## Extras que el PC permite

- **Recordatorios reales** (lo que una PWA no puede en iOS): un programador manda avisos al móvil
  (ntfy o similar) o muestra notificaciones de Windows. Solo funciona con la máquina encendida.
- Generar el archivo de deudas que la PWA ya sabe importar, para mantener ambos en sincronía.

## Fases

| Fase | Contenido | Resultado |
| --- | --- | --- |
| 1 | Bandeja, lectores de PDF portados, SQLite y dashboard con lo que ya existe | Sueltas el estado del mes y todo se actualiza |
| 2 | Ollama, OCR de facturas, clasificación y cola de revisión | Las facturas entran solas |
| 3 | Subida desde el iPhone y recordatorios | Cero fricción |
| 4 | Chat sobre los datos (solo lectura) | Preguntas en lenguaje normal |

**Recomendación:** empezar por la fase 1 sin IA. Resuelve gran parte del problema y es la base de
las demás.

## Riesgos

- Un portátil que se duerme no procesa nada: configurar la suspensión.
- Una GPU de 6 GB limita el modelo: mantener tareas simples y verificables.
- Los bancos cambian el formato: el lector necesita mantenimiento.
- El modelo local **no sustituye** a un asesor ni a una auditoría.
- Claude no queda residente: construye y mantiene el sistema; el trabajo diario lo hace el modelo local.

## Decisiones abiertas — pregúntaselas al usuario

1. ¿Cómo mover las fotos del iPhone al PC? (recomendado: Tailscale)
2. ¿Panel solo en el PC o también accesible desde el móvil? (lo segundo exige Tailscale o Access)
3. ¿Dónde viven los datos? (propuesta: carpeta fuera del repo)
4. **La máquina nueva con Cloudflare:** ¿propia en casa o VPS? ¿qué GPU tiene? ¿qué se expone?
