"""API de facturas: sube una foto, la lee (OCR + Ollama), la verifica y la deja en una bandeja.
Datos fuera del repo: ~/finanzas (o $GASTOS_DATOS). Solo escucha en 127.0.0.1."""
import hashlib
import io
import json
import os
import queue
import re
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from pydantic import BaseModel

import lectura
import verificar
from acceso import exigir

DATOS = Path(os.environ.get('GASTOS_DATOS', Path.home() / 'finanzas'))
FOTOS = DATOS / 'facturas'
FOTOS.mkdir(parents=True, exist_ok=True)
ORIGEN_PWA = 'https://amaurylopezmedina.github.io'
ORIGENES = [ORIGEN_PWA] + [o for o in os.environ.get('GASTOS_ORIGENES_EXTRA', '').split(',') if o]   # extra: solo para pruebas
MAX_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 50_000_000

app = FastAPI(title='Gastos', docs_url=None, redoc_url=None, openapi_url=None,
              dependencies=[Depends(exigir)])
app.add_middleware(CORSMiddleware, allow_origins=ORIGENES, allow_methods=['GET', 'POST', 'PUT'],
                   allow_headers=['content-type', 'cf-access-client-id', 'cf-access-client-secret'])

_local = threading.local()


def con():
    if not hasattr(_local, 'c'):
        c = sqlite3.connect(DATOS / 'finanzas.db')
        c.row_factory = sqlite3.Row
        c.executescript("""
            CREATE TABLE IF NOT EXISTS facturas(
              id TEXT PRIMARY KEY, creada REAL, estado TEXT, ocr_texto TEXT, ocr_conf REAL,
              campos TEXT, problemas TEXT, error TEXT, leida_por TEXT);
            CREATE TABLE IF NOT EXISTS reglas(comercio TEXT PRIMARY KEY, categoria TEXT);
        """)
        _local.c = c
    return _local.c


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def fila(r, completo=False):
    d = {'id': r['id'], 'creada': r['creada'], 'estado': r['estado'],
         'campos': json.loads(r['campos'] or 'null'), 'problemas': json.loads(r['problemas'] or '[]'),
         'leida_por': r['leida_por'], 'error': r['error']}
    if completo:
        d['ocr_texto'] = r['ocr_texto']
    return d


# ---------------------------------------------------------------- procesado

cola = queue.Queue()


def procesar(fid):
    c = con()
    c.execute("UPDATE facturas SET estado='leyendo' WHERE id=?", (fid,))
    c.commit()
    try:
        texto, conf = lectura.ocr(str(FOTOS / f'{fid}.jpg'))
        campos = lectura.ollama(texto)
        por = 'ollama'
        if campos is None:                       # sin IA: solo expresiones regulares, siempre a revisar
            campos, por = lectura.heuristica(texto), 'heuristica'
            campos['total'] = campos.get('total')
        regla = c.execute('SELECT categoria FROM reglas WHERE comercio=?', (norm(campos.get('comercio')),)).fetchone()
        if regla:
            campos['categoria'] = regla['categoria']
        problemas = verificar.verificar(campos, texto, conf)
        if por != 'ollama':
            problemas.append('sin_ia')
        estado = 'listo' if not problemas else 'revisar'
        c.execute('UPDATE facturas SET estado=?, ocr_texto=?, ocr_conf=?, campos=?, problemas=?, leida_por=?, error=NULL WHERE id=? AND estado=\'leyendo\'',
                  (estado, texto, conf, json.dumps(campos), json.dumps(problemas), por, fid))
    except Exception as e:                       # nunca perder la foto por un fallo de lectura
        c.execute("UPDATE facturas SET estado='revisar', error=?, problemas=? WHERE id=? AND estado='leyendo'",
                  (type(e).__name__, json.dumps(['fallo_de_lectura']), fid))
    c.commit()


def trabajador():
    while True:
        procesar(cola.get())


@app.on_event('startup')
def arrancar():
    threading.Thread(target=trabajador, daemon=True).start()
    for r in con().execute("SELECT id FROM facturas WHERE estado IN ('nueva','leyendo')"):
        cola.put(r['id'])


# ---------------------------------------------------------------- rutas

@app.get('/salud')
def salud():
    try:
        ok = lectura.httpx.get(f'{lectura.OLLAMA}/api/version', timeout=2).status_code == 200
    except Exception:
        ok = False
    return {'ok': True, 'ollama': ok, 'modelo': lectura.MODELO}


@app.post('/facturas')
async def subir(archivo: UploadFile = File(...)):
    datos = await archivo.read(MAX_BYTES + 1)
    if len(datos) > MAX_BYTES:
        raise HTTPException(413, 'archivo demasiado grande')
    try:
        img = Image.open(io.BytesIO(datos))
        img.load()
        if img.format not in ('JPEG', 'PNG', 'WEBP'):
            raise ValueError
        img = ImageOps.exif_transpose(img).convert('RGB')
    except Exception:
        raise HTTPException(415, 'imagen no valida')
    img.thumbnail((2000, 2000))
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=85)           # se re-codifica: nunca se guarda lo subido tal cual
    fid = hashlib.sha256(buf.getvalue()).hexdigest()[:16]
    c = con()
    if c.execute('SELECT 1 FROM facturas WHERE id=?', (fid,)).fetchone():
        return {'id': fid, 'repetida': True}
    (FOTOS / f'{fid}.jpg').write_bytes(buf.getvalue())
    c.execute("INSERT INTO facturas(id, creada, estado) VALUES(?,?,'nueva')", (fid, time.time()))
    c.commit()
    cola.put(fid)
    return {'id': fid, 'repetida': False}


@app.get('/facturas')
def listar(estado: str = 'nueva,leyendo,listo,revisar'):
    est = [e for e in estado.split(',') if e in ('nueva', 'leyendo', 'listo', 'revisar', 'aplicada', 'descartada')]
    q = ','.join('?' * len(est))
    rows = con().execute(f'SELECT * FROM facturas WHERE estado IN ({q}) ORDER BY creada DESC LIMIT 200', est)
    return [fila(r) for r in rows]


def obtener(fid):
    if not re.fullmatch(r'[0-9a-f]{16}', fid):
        raise HTTPException(404)
    r = con().execute('SELECT * FROM facturas WHERE id=?', (fid,)).fetchone()
    if not r:
        raise HTTPException(404)
    return r


@app.get('/facturas/{fid}')
def detalle(fid: str):
    return fila(obtener(fid), completo=True)


@app.get('/facturas/{fid}/foto')
def foto(fid: str):
    obtener(fid)
    return FileResponse(FOTOS / f'{fid}.jpg', media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


class Correccion(BaseModel):
    comercio: str
    fecha: str
    total: str
    categoria: str
    tipo: str = 'gasto'


@app.put('/facturas/{fid}')
def corregir(fid: str, c: Correccion):
    """El usuario confirma o corrige: lo que el escribe manda sobre la IA."""
    r = obtener(fid)
    total = verificar.a_centimos(c.total)
    if not total or total <= 0 or verificar.fecha_valida(c.fecha) is None \
            or c.categoria not in verificar.CATEGORIAS or c.tipo not in ('gasto', 'ingreso') or not c.comercio.strip():
        raise HTTPException(422, 'datos no validos')
    campos = json.loads(r['campos'] or '{}')
    campos.update(comercio=c.comercio.strip()[:60], fecha=c.fecha, total=total, categoria=c.categoria, tipo=c.tipo)
    db = con()
    db.execute('INSERT OR REPLACE INTO reglas(comercio, categoria) VALUES(?,?)', (norm(c.comercio), c.categoria))
    db.execute("UPDATE facturas SET campos=?, problemas='[]', estado='listo' WHERE id=?", (json.dumps(campos), fid))
    db.commit()
    return fila(obtener(fid))


class Estado(BaseModel):
    estado: str


@app.post('/facturas/{fid}/estado')
def cambiar_estado(fid: str, e: Estado):
    r = obtener(fid)
    if e.estado not in ('aplicada', 'descartada'):
        raise HTTPException(422)
    if e.estado == 'aplicada' and r['estado'] not in ('listo', 'aplicada'):
        raise HTTPException(409, 'primero confirma los datos')    # nada sin verificar entra a la cuenta
    con().execute('UPDATE facturas SET estado=? WHERE id=?', (e.estado, fid))
    con().commit()
    return {'ok': True}
