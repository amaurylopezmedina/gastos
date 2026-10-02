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

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, ImageOps
from pydantic import BaseModel

import lectura
import reglas_rubro
import rubros
import verificar
from acceso import exigir

DATOS = Path(os.environ.get('GASTOS_DATOS', Path.home() / 'finanzas'))
FOTOS = DATOS / 'facturas'
FOTOS.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 50_000_000

app = FastAPI(title='Gastos', docs_url=None, redoc_url=None, openapi_url=None,
              dependencies=[Depends(exigir)])
api = APIRouter(prefix='/api')

_local = threading.local()


def con():
    if not hasattr(_local, 'c'):
        c = sqlite3.connect(DATOS / 'finanzas.db')
        c.row_factory = sqlite3.Row
        c.executescript("""
            CREATE TABLE IF NOT EXISTS facturas(
              id TEXT PRIMARY KEY, creada REAL, estado TEXT, ocr_texto TEXT, ocr_conf REAL,
              campos TEXT, problemas TEXT, error TEXT, leida_por TEXT);
            CREATE TABLE IF NOT EXISTS reglas_rubro(comercio TEXT PRIMARY KEY, rubro TEXT);
            CREATE TABLE IF NOT EXISTS estado(id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER, datos TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS estado_hist(rev INTEGER PRIMARY KEY, datos TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS fotos(id TEXT PRIMARY KEY, datos BLOB, ts REAL);
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


def decidir_rubro(c, campos, texto, usar_ia):
    """Orden: lo que el usuario corrigio antes > palabras clave > modelo. Sin certeza, None (lo elige el usuario)."""
    regla = c.execute('SELECT rubro FROM reglas_rubro WHERE comercio=?', (norm(campos.get('comercio')),)).fetchone()
    if regla and regla['rubro'] in rubros.IDS_GASTO:
        return regla['rubro'], 'aprendido'
    descs = [(l.get('desc') or '') for l in campos.get('lineas') or []]
    por_pal = reglas_rubro.por_palabras(campos.get('comercio'), descs, texto)
    if por_pal:
        return por_pal, 'palabras'
    if usar_ia:
        r = lectura.clasificar_llm(campos.get('comercio'), campos.get('lineas'))
        if r:
            return r, 'ia'
    return None, None


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
        campos['rubro'], campos['rubro_por'] = decidir_rubro(c, campos, texto, usar_ia=(por == 'ollama'))
        campos['categoria'] = rubros.CATEGORIA.get(campos['rubro'], 'otros')
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

@api.get('/salud')
def salud():
    try:
        ok = lectura.httpx.get(f'{lectura.OLLAMA}/api/version', timeout=2).status_code == 200
    except Exception:
        ok = False
    return {'ok': True, 'ollama': ok, 'modelo': lectura.MODELO}


@api.post('/facturas')
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


@api.get('/facturas')
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


@api.get('/facturas/{fid}')
def detalle(fid: str):
    return fila(obtener(fid), completo=True)


@api.get('/facturas/{fid}/foto')
def foto(fid: str):
    obtener(fid)
    return FileResponse(FOTOS / f'{fid}.jpg', media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


class Correccion(BaseModel):
    comercio: str
    fecha: str
    total: str
    rubro: str
    tipo: str = 'gasto'


@api.put('/facturas/{fid}')
def corregir(fid: str, c: Correccion):
    """El usuario confirma o corrige: lo que el escribe manda sobre la IA."""
    r = obtener(fid)
    total = verificar.a_centimos(c.total)
    if not total or total <= 0 or verificar.fecha_valida(c.fecha) is None \
            or c.rubro not in rubros.IDS_GASTO or c.tipo != 'gasto' or not c.comercio.strip():
        raise HTTPException(422, 'datos no validos')
    campos = json.loads(r['campos'] or '{}')
    campos.update(comercio=c.comercio.strip()[:60], fecha=c.fecha, total=total, rubro=c.rubro,
                  categoria=rubros.CATEGORIA[c.rubro], tipo='gasto')
    db = con()
    db.execute('INSERT OR REPLACE INTO reglas_rubro(comercio, rubro) VALUES(?,?)', (norm(c.comercio), c.rubro))
    db.execute("UPDATE facturas SET campos=?, problemas='[]', estado='listo' WHERE id=?", (json.dumps(campos), fid))
    db.commit()
    return fila(obtener(fid))


class Estado(BaseModel):
    estado: str


@api.post('/facturas/{fid}/estado')
def cambiar_estado(fid: str, e: Estado):
    r = obtener(fid)
    if e.estado not in ('aplicada', 'descartada'):
        raise HTTPException(422)
    if e.estado == 'aplicada' and r['estado'] not in ('listo', 'aplicada'):
        raise HTTPException(409, 'primero confirma los datos')    # nada sin verificar entra a la cuenta
    db = con()
    if e.estado == 'aplicada':                # la foto pasa al almacen de la app, con id fijo
        db.execute('INSERT OR REPLACE INTO fotos(id, datos, ts) VALUES(?,?,?)',
                   (f'ph_f_{fid}', (FOTOS / f'{fid}.jpg').read_bytes(), time.time()))
    db.execute('UPDATE facturas SET estado=? WHERE id=?', (e.estado, fid))
    db.commit()
    return {'ok': True}


# ---------------------------------------------------------------- estado de la app
# La app guarda aqui TODOS sus datos (gastos, deudas, presupuesto...). Control de version
# optimista: quien escribe dice sobre que version lo hace; si otro cambio algo antes, 409.
# Cada version se conserva (las 400 ultimas), asi un error nunca pierde datos.

MAX_ESTADO = 8 * 1024 * 1024
HIST_MAX = 400


@api.get('/estado')
def estado_leer():
    r = con().execute('SELECT rev, datos FROM estado WHERE id=1').fetchone()
    return {'rev': r['rev'], 'datos': json.loads(r['datos'])} if r else {'rev': 0, 'datos': None}


class EstadoIn(BaseModel):
    rev: int
    datos: dict


@api.put('/estado')
def estado_guardar(e: EstadoIn):
    raw = json.dumps(e.datos, ensure_ascii=False)
    if len(raw.encode()) > MAX_ESTADO:
        raise HTTPException(413, 'estado demasiado grande')
    if not isinstance(e.datos.get('v'), int) or not isinstance(e.datos.get('expenses'), list):
        raise HTTPException(422, 'estado no valido')
    db = con()
    db.execute('BEGIN IMMEDIATE')
    try:
        r = db.execute('SELECT rev, datos FROM estado WHERE id=1').fetchone()
        actual = r['rev'] if r else 0
        if e.rev != actual:
            db.execute('ROLLBACK')
            return JSONResponse({'rev': actual, 'datos': json.loads(r['datos']) if r else None}, status_code=409)
        nuevo = actual + 1
        ahora = time.time()
        db.execute('INSERT OR REPLACE INTO estado(id, rev, datos, ts) VALUES(1,?,?,?)', (nuevo, raw, ahora))
        db.execute('INSERT INTO estado_hist(rev, datos, ts) VALUES(?,?,?)', (nuevo, raw, ahora))
        db.execute('DELETE FROM estado_hist WHERE rev <= ?', (nuevo - HIST_MAX,))
        db.execute('COMMIT')
    except Exception:
        if db.in_transaction:
            db.execute('ROLLBACK')
        raise
    return {'rev': nuevo}


# ---------------------------------------------------------------- fotos de los gastos

_PID = re.compile(r'[A-Za-z0-9_\-]{1,100}')
MAX_FOTO = 6 * 1024 * 1024


def pid_ok(pid):
    if not _PID.fullmatch(pid):
        raise HTTPException(404)
    return pid


@api.get('/fotos')
def fotos_ids():
    return [r['id'] for r in con().execute('SELECT id FROM fotos ORDER BY ts')]


@api.get('/fotos/{pid}')
def foto_leer(pid: str):
    r = con().execute('SELECT datos FROM fotos WHERE id=?', (pid_ok(pid),)).fetchone()
    if not r:
        raise HTTPException(404)
    return Response(r['datos'], media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=86400'})


@api.put('/fotos/{pid}')
async def foto_guardar(pid: str, request: Request):
    datos = await request.body()
    if len(datos) > MAX_FOTO:
        raise HTTPException(413, 'foto demasiado grande')
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
    img.save(buf, 'JPEG', quality=85)
    db = con()
    db.execute('INSERT OR REPLACE INTO fotos(id, datos, ts) VALUES(?,?,?)', (pid_ok(pid), buf.getvalue(), time.time()))
    db.commit()
    return {'ok': True}


@api.delete('/fotos/{pid}')
def foto_borrar(pid: str):
    db = con()
    db.execute('DELETE FROM fotos WHERE id=?', (pid_ok(pid),))
    db.commit()
    return {'ok': True}


app.include_router(api)

# ---------------------------------------------------------------- la propia app (archivos publicos)
# Lista cerrada: solo estos archivos de la raiz del repo y estas carpetas. Nada mas del repo
# (PRIVADO/, servidor/, docs/, .git...) se puede pedir, aunque se intente con rutas raras.

WEB = Path(__file__).resolve().parent.parent
WEB_ARCHIVOS = {'index.html', 'styles.css', 'app.js', 'i18n.js', 'statement.js', 'reconcile.js', 'loans.js',
                'rubros.js', 'sync.js', 'presupuesto.js', 'bandeja.js', 'sw.js', 'manifest.webmanifest'}
WEB_CARPETAS = {'icons': {'.png'}, 'vendor': {'.js'}}
_TIPOS = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
          '.webmanifest': 'application/manifest+json'}


@app.get('/{ruta:path}', include_in_schema=False)
def web(ruta: str):
    ruta = ruta or 'index.html'
    partes = ruta.split('/')
    if len(partes) == 1 and ruta in WEB_ARCHIVOS:
        f = WEB / ruta
    elif len(partes) == 2 and partes[0] in WEB_CARPETAS and re.fullmatch(r'[A-Za-z0-9_.\-]+', partes[1]) \
            and Path(partes[1]).suffix in WEB_CARPETAS[partes[0]]:
        f = WEB / partes[0] / partes[1]
    else:
        raise HTTPException(404)
    if not f.is_file():
        raise HTTPException(404)
    return FileResponse(f, media_type=_TIPOS.get(f.suffix, 'application/octet-stream'),
                        headers={'Cache-Control': 'no-cache'})
