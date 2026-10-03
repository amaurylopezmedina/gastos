import io
import os
import tempfile

os.environ['GASTOS_DATOS'] = tempfile.mkdtemp()
os.environ.pop('ACCESS_TEAM', None)
os.environ.pop('ACCESS_AUD', None)

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app as servidor


@pytest.fixture()
def c():
    with TestClient(servidor.app) as cli:
        yield cli


def jpg(color='white', size=(40, 30)):
    b = io.BytesIO()
    Image.new('RGB', size, color).save(b, 'JPEG')
    return b.getvalue()


# ---- la app se sirve, pero SOLO lo permitido

def test_sirve_la_app(c):
    assert c.get('/').status_code == 200 and b'<html' in c.get('/').content
    assert c.get('/app.js').headers['content-type'].startswith('text/javascript')
    assert c.get('/icons/icon-192.png').status_code == 200
    assert c.get('/rubros.js').status_code == 200


def test_todo_lo_que_la_app_necesita_se_sirve(c):
    """Cada script, hoja de estilo, icono y archivo del SHELL del service worker debe poder pedirse."""
    import re
    from pathlib import Path
    raiz = Path(servidor.WEB)
    html = (raiz / 'index.html').read_text(encoding='utf-8')
    sw = (raiz / 'sw.js').read_text(encoding='utf-8')
    pedidos = set(re.findall(r'(?:src|href)="([^"#:]+)"', html))
    pedidos |= set(re.findall(r"'\./([^']+)'", sw.split('const SHELL')[1].split(']')[0]))
    pedidos.discard('')
    assert len(pedidos) >= 12
    for ruta in sorted(pedidos):
        assert c.get('/' + ruta).status_code == 200, ruta


@pytest.mark.parametrize('ruta', [
    '/PRIVADO/CONTEXTO-FINANCIERO.md', '/servidor/app.py', '/.git/config', '/docs/PROYECTO.md', '/CLAUDE.md',
    '/../servidor/app.py', '/%2e%2e/servidor/app.py', '/icons/../servidor/app.py', '/icons/%2e%2e/CLAUDE.md',
    '/vendor/../app.py', '/icons/x.py', '/vendor/pdf.min.js.map', '/README.md', '/.gitignore', '/api/nada'])
def test_no_sirve_nada_mas(c, ruta):
    r = c.get(ruta)
    assert r.status_code == 404, ruta


# ---- por el tunel solo con un JWT valido (sin configuracion de Access: se rechaza todo)

@pytest.mark.parametrize('cabecera', [{'Cf-Connecting-Ip': '1.2.3.4'}, {'Cf-Ray': 'x'}, {'Cf-Access-Jwt-Assertion': 'a.b.c'}])
def test_por_tunel_sin_jwt_valido(c, cabecera):
    assert c.get('/api/estado', headers=cabecera).status_code == 403
    assert c.get('/', headers=cabecera).status_code == 403          # tambien la app: va detras de Access
    assert c.put('/api/estado', json={'rev': 0, 'datos': {}}, headers=cabecera).status_code == 403


# ---- estado con control de versiones

def test_estado_versionado(c):
    assert c.get('/api/estado').json() == {'rev': 0, 'datos': None}
    a = {'v': 3, 'expenses': [{'id': 'a'}]}
    assert c.put('/api/estado', json={'rev': 0, 'datos': a}).json() == {'rev': 1}
    b = {'v': 3, 'expenses': [{'id': 'a'}, {'id': 'b'}]}
    assert c.put('/api/estado', json={'rev': 1, 'datos': b}).json() == {'rev': 2}
    # otro dispositivo escribe sobre una version vieja: 409 y recibe lo vigente
    r = c.put('/api/estado', json={'rev': 1, 'datos': a})
    assert r.status_code == 409 and r.json()['rev'] == 2 and len(r.json()['datos']['expenses']) == 2
    assert c.get('/api/estado').json()['datos'] == b


def test_estado_invalido(c):
    assert c.put('/api/estado', json={'rev': 0, 'datos': {'x': 1}}).status_code == 422
    assert c.put('/api/estado', json={'rev': 0, 'datos': {'v': 3, 'expenses': 'no'}}).status_code == 422


def test_historial_conserva_versiones(c):
    rev = c.get('/api/estado').json()['rev']
    for i in range(3):
        rev = c.put('/api/estado', json={'rev': rev, 'datos': {'v': 3, 'expenses': [{'id': str(i)}]}}).json()['rev']
    n = servidor.con().execute('SELECT COUNT(*) FROM estado_hist').fetchone()[0]
    assert n >= 3


# ---- fotos

def test_fotos(c):
    assert c.put('/api/fotos/ph_1', content=jpg()).status_code == 200
    r = c.get('/api/fotos/ph_1')
    assert r.status_code == 200 and r.headers['content-type'] == 'image/jpeg'
    assert 'ph_1' in c.get('/api/fotos').json()
    assert c.delete('/api/fotos/ph_1').status_code == 200 and c.get('/api/fotos/ph_1').status_code == 404


def test_fotos_validan(c):
    assert c.put('/api/fotos/ph_2', content=b'esto no es una imagen').status_code == 415
    assert c.put('/api/fotos/ph_3', content=b'0' * (7 * 1024 * 1024)).status_code == 413
    assert c.put('/api/fotos/..%2Fx', content=jpg()).status_code in (404, 405)
    assert c.get('/api/fotos/a b').status_code == 404


# ---- facturas: de la subida a la foto en el almacen de la app

def _leer(c, monkeypatch, comercio, rubro_ia=None, color='red'):
    import time
    monkeypatch.setattr(servidor.lectura, 'ocr', lambda ruta: (f'{comercio}\nTOTAL 1,239.00', 0.95))
    monkeypatch.setattr(servidor.lectura, 'ollama', lambda texto: {
        'comercio': comercio, 'fecha': '2026-10-01', 'total': 123900, 'tipo': 'gasto', 'lineas': []})
    monkeypatch.setattr(servidor.lectura, 'clasificar_llm', lambda comercio, lineas: rubro_ia)
    fid = c.post('/api/facturas', files={'archivo': ('f.jpg', jpg(color), 'image/jpeg')}).json()['id']
    for _ in range(200):
        f = c.get(f'/api/facturas/{fid}').json()
        if f['estado'] not in ('nueva', 'leyendo'):
            return fid, f
        time.sleep(0.05)
    raise AssertionError('no termino de leerse')


def test_rubro_por_palabras_clave(c, monkeypatch):
    fid, f = _leer(c, monkeypatch, 'Supermercado Ejemplo', color='blue')
    assert f['estado'] == 'listo' and f['campos']['rubro'] == 'super' and f['campos']['rubro_por'] == 'palabras'
    assert f['campos']['categoria'] == 'super'


def test_rubro_por_el_modelo_si_las_palabras_no_alcanzan(c, monkeypatch):
    fid, f = _leer(c, monkeypatch, 'Negocio Raro SRL', rubro_ia='colmado', color='green')
    assert f['campos']['rubro'] == 'colmado' and f['campos']['rubro_por'] == 'ia' and f['estado'] == 'listo'


def test_sin_rubro_seguro_queda_en_revisar(c, monkeypatch):
    fid, f = _leer(c, monkeypatch, 'Otro Negocio Raro', rubro_ia=None, color='yellow')
    assert f['campos']['rubro'] is None and f['estado'] == 'revisar' and 'rubro_desconocido' in f['problemas']


def test_factura_aplicada_copia_su_foto_y_aprende(c, monkeypatch):
    fid, f = _leer(c, monkeypatch, 'Supermercado Ejemplo', color='purple')
    # el usuario corrige el rubro: se aprende para ese comercio y manda sobre las palabras clave
    r = c.put(f'/api/facturas/{fid}', json={'comercio': 'Supermercado Ejemplo', 'fecha': '2026-10-01', 'total': '1239.00', 'rubro': 'colmado'})
    assert r.status_code == 200 and r.json()['campos']['categoria'] == 'super'
    assert c.put(f'/api/facturas/{fid}', json={'comercio': 'x', 'fecha': '2026-10-01', 'total': '1.00', 'rubro': 'sueldo'}).status_code == 422
    assert c.post(f'/api/facturas/{fid}/estado', json={'estado': 'aplicada'}).status_code == 200
    assert c.get(f'/api/fotos/ph_f_{fid}').status_code == 200          # la foto ya esta en el almacen de la app
    fid2, f2 = _leer(c, monkeypatch, 'Supermercado Ejemplo', color='orange')
    assert f2['campos']['rubro'] == 'colmado' and f2['campos']['rubro_por'] == 'aprendido'


def test_no_se_aplica_una_factura_sin_confirmar(c, monkeypatch):
    fid, f = _leer(c, monkeypatch, 'Otro Negocio Mas', rubro_ia=None, color='black')
    assert f['estado'] == 'revisar'
    assert c.post(f'/api/facturas/{fid}/estado', json={'estado': 'aplicada'}).status_code == 409


def test_clasificar_lineas_de_un_extracto(c):
    r = c.post('/api/clasificar', json={'comercios': ['JUMBO MOCA', 'SHELL EST DE COMB DEL VIA', 'SCOTIABANK COBRANZAS TARJ', 'AGRORI']})
    assert r.json() == {'rubros': ['super', 'combustible', 'cuotas', None]}


def test_lo_que_el_usuario_corrige_se_aprende_y_manda(c):
    assert c.post('/api/aprender', json=[{'comercio': 'AGRORI', 'rubro': 'mascotas'}, {'comercio': 'X', 'rubro': 'sueldo'}]).json() == {'aprendidos': 1}
    assert c.post('/api/clasificar', json={'comercios': ['AGRORI', 'agrori']}).json() == {'rubros': ['mascotas', 'mascotas']}
    c.post('/api/aprender', json=[{'comercio': 'JUMBO MOCA', 'rubro': 'colmado'}])
    assert c.post('/api/clasificar', json={'comercios': ['JUMBO MOCA']}).json() == {'rubros': ['colmado']}


def test_clasificar_limita_el_tamano(c):
    assert c.post('/api/clasificar', json={'comercios': ['x'] * 1001}).status_code == 413


def test_ninguna_respuesta_se_puede_cachear_en_el_borde(c):
    """Ni siquiera los errores: Cloudflare cachea un 404 de un .js durante minutos."""
    for ruta in ('/', '/app.js', '/no-existe.js', '/api/estado', '/api/fotos/nada', '/PRIVADO/x.js'):
        assert c.get(ruta).headers.get('cache-control') == 'no-store', ruta


def test_voucher_de_tarjeta_se_lee_sin_modelo_y_propone_la_tarjeta(c, monkeypatch):
    import time
    from datetime import datetime
    hoy = datetime.now().strftime('%d/%m/%y')
    texto = ("LUBRICAR EJEMPLO\nMOCA.DO\nID Conercio:000000001234567  AZUL\nPagos Rapidos\nX00*00*0000X9999  Venta\nVISA  Visa Credit\n"
             f"Metodo Entrada: Sin Contacto\n{hoy}  14:41:38\nAID:A0000000031010\nTran #::0000000001  Aprobaclon #:123456\nLote #:000001\n"
             "Honto:  00  1,000.51\nITBIS:  180.00\nTotal:  DOP  1,180.00\nCopia Cliente")
    monkeypatch.setattr(servidor.lectura, 'ocr', lambda ruta: (texto, 0.92))
    def no_debe_llamarse(*a, **k): raise AssertionError('un voucher no debe usar el modelo para extraer')
    monkeypatch.setattr(servidor.lectura, 'ollama', no_debe_llamarse)
    monkeypatch.setattr(servidor.lectura, 'clasificar_llm', lambda comercio, lineas: None)
    fid = c.post('/api/facturas', files={'archivo': ('v.jpg', jpg('pink'), 'image/jpeg')}).json()['id']
    for _ in range(200):
        f = c.get(f'/api/facturas/{fid}').json()
        if f['estado'] not in ('nueva', 'leyendo'):
            break
        time.sleep(0.05)
    k = f['campos']
    assert f['leida_por'] == 'voucher' and f['estado'] == 'listo' and f['problemas'] == []
    assert k['total'] == 118000 and k['itbis'] == 18000 and k['subtotal'] == 100000 and k['tarjeta'] == '9999'
    assert k['rubro'] == 'mant_veh' and k['categoria'] == 'transpor'


def _esperar(c, fid, hasta=('listo', 'revisar', 'aplicada', 'descartada')):
    import time
    for _ in range(300):
        f = c.get(f'/api/facturas/{fid}').json()
        if f['estado'] in hasta:
            return f
        time.sleep(0.05)
    raise AssertionError('no termino: ' + f['estado'])


def test_lista_de_todos_los_documentos_y_reprocesar(c, monkeypatch):
    llamadas = []
    def ocr(ruta):
        llamadas.append(ruta)
        return ('' if len(llamadas) == 1 else 'SUPERMERCADO EJEMPLO\nTOTAL 1,239.00', 0.9)       # la 1a lectura sale vacia
    monkeypatch.setattr(servidor.lectura, 'ocr', ocr)
    monkeypatch.setattr(servidor.lectura, 'ollama', lambda t: {'comercio': 'Supermercado Ejemplo', 'fecha': '2026-10-01', 'total': 123900,
                                                                 'tipo': 'gasto', 'lineas': []} if t else None)
    monkeypatch.setattr(servidor.lectura, 'clasificar_llm', lambda comercio, lineas: None)
    fid = c.post('/api/facturas', files={'archivo': ('f.jpg', jpg('cyan'), 'image/jpeg')}).json()['id']
    f = _esperar(c, fid)
    assert f['estado'] == 'revisar'                                   # no se pudo leer
    # reprocesar: vuelve a leerse y esta vez sale bien
    r = c.post(f'/api/facturas/{fid}/reprocesar').json()
    assert r['ok'] is True
    f = _esperar(c, fid)
    assert f['estado'] == 'listo' and f['campos']['total'] == 123900 and len(llamadas) == 2
    # aparece en la lista completa, tambien despues de cargarse
    assert c.post(f'/api/facturas/{fid}/estado', json={'estado': 'aplicada'}).status_code == 200
    todas = c.get('/api/facturas?estado=todas').json()
    assert fid in [x['id'] for x in todas] and fid not in [x['id'] for x in c.get('/api/facturas').json()]
    # lo ya cargado no se reprocesa
    assert c.post(f'/api/facturas/{fid}/reprocesar').status_code == 409
    assert c.post('/api/facturas/0000000000000000/reprocesar').status_code == 404


def test_reprocesar_una_descartada_y_no_duplicar_lecturas(c, monkeypatch):
    import time
    monkeypatch.setattr(servidor.lectura, 'ocr', lambda ruta: (time.sleep(0.4), ('TIENDA EJEMPLO\nTOTAL 10.00', 0.9))[1])
    monkeypatch.setattr(servidor.lectura, 'ollama', lambda t: {'comercio': 'Tienda Ejemplo', 'fecha': '2026-10-01', 'total': 1000, 'tipo': 'gasto', 'lineas': []})
    monkeypatch.setattr(servidor.lectura, 'clasificar_llm', lambda comercio, lineas: None)
    fid = c.post('/api/facturas', files={'archivo': ('f.jpg', jpg('gray'), 'image/jpeg')}).json()['id']
    # mientras se lee, pedir reprocesar no lanza una segunda lectura
    assert c.post(f'/api/facturas/{fid}/reprocesar').json()['ya_en_cola'] is True
    _esperar(c, fid)
    assert c.post(f'/api/facturas/{fid}/estado', json={'estado': 'descartada'}).status_code == 200
    assert c.post(f'/api/facturas/{fid}/reprocesar').json()['ya_en_cola'] is False       # una descartada se puede recuperar
    assert _esperar(c, fid)['estado'] in ('listo', 'revisar')


def test_foto_de_tarjeta_devuelve_solo_lo_imprescindible_y_no_guarda_nada(c, monkeypatch):
    import os
    from pathlib import Path
    texto = 'BHD\nVISA CREDITO\n4111 1111 1111 9876\nVALID THRU 12/29\nCVV 123\nJUAN EJEMPLO PEREZ'
    rutas = []
    def falso_ocr(ruta):
        rutas.append(ruta)
        assert os.path.exists(ruta)                       # existe mientras se lee...
        return texto, 0.9
    monkeypatch.setattr(servidor.lectura, 'ocr', falso_ocr)
    antes_db = servidor.con().execute('SELECT COUNT(*) FROM facturas').fetchone()[0]
    antes_fotos = len(list(servidor.FOTOS.glob('*')))
    r = c.post('/api/tarjeta', files={'archivo': ('t.jpg', jpg('gold'), 'image/jpeg')})
    assert r.status_code == 200
    assert r.json() == {'ultimos4': '9876', 'marca': 'Visa', 'banco': 'BHD', 'tipo': 'credito'}
    blob = r.text
    for secreto in ('4111', '1111', '12/29', '123', 'JUAN', 'PEREZ', 'texto'):
        assert secreto not in blob
    assert not os.path.exists(rutas[0])                   # ...y se borra al terminar
    assert servidor.con().execute('SELECT COUNT(*) FROM facturas').fetchone()[0] == antes_db
    assert len(list(servidor.FOTOS.glob('*'))) == antes_fotos          # no se guardo la foto


def test_foto_de_tarjeta_valida_el_archivo(c):
    assert c.post('/api/tarjeta', files={'archivo': ('t.jpg', b'no es imagen', 'image/jpeg')}).status_code == 415


def test_foto_sin_texto_no_se_inventa_nada(c, monkeypatch):
    monkeypatch.setattr(servidor.lectura, 'ocr', lambda ruta: ('', 0.0))
    def no_debe_llamarse(*a, **k): raise AssertionError('sin texto no se consulta al modelo')
    monkeypatch.setattr(servidor.lectura, 'ollama', no_debe_llamarse)
    monkeypatch.setattr(servidor.lectura, 'clasificar_llm', no_debe_llamarse)
    fid = c.post('/api/facturas', files={'archivo': ('f.jpg', jpg('white', (30, 30)), 'image/jpeg')}).json()['id']
    f = _esperar(c, fid)
    assert f['estado'] == 'revisar' and f['problemas'] == ['sin_texto'] and f['campos']['comercio'] is None and f['leida_por'] == 'sin_texto'


def test_el_modelo_no_puede_llamar_null_a_un_comercio(monkeypatch):
    class R:
        def raise_for_status(self): pass
        def json(self): return {'message': {'content': '{"comercio": "null", "fecha": "2026-10-01", "total": "10.00", "tipo": "gasto", "lineas": []}'}}
    monkeypatch.setattr(servidor.lectura.httpx, 'post', lambda *a, **k: R())
    assert servidor.lectura.ollama('algo de texto largo')['comercio'] == ''


def test_sustituir_la_foto_de_un_documento(c, monkeypatch):
    estados = iter(['', 'SUPERMERCADO EJEMPLO\nTOTAL 10.00'])           # la 1a foto sale vacia; la sustituta se lee bien
    monkeypatch.setattr(servidor.lectura, 'ocr', lambda ruta: (next(estados), 0.9))
    monkeypatch.setattr(servidor.lectura, 'ollama', lambda t: {'comercio': 'Supermercado Ejemplo', 'fecha': '2026-10-01', 'total': 1000, 'tipo': 'gasto', 'lineas': []})
    monkeypatch.setattr(servidor.lectura, 'clasificar_llm', lambda comercio, lineas: None)
    fid = c.post('/api/facturas', files={'archivo': ('f.jpg', jpg('olive'), 'image/jpeg')}).json()['id']
    assert _esperar(c, fid)['estado'] == 'revisar'
    antes = (servidor.FOTOS / f'{fid}.jpg').read_bytes()
    r = c.post(f'/api/facturas/{fid}/sustituir', files={'archivo': ('n.jpg', jpg('navy', (50, 40)), 'image/jpeg')})
    assert r.status_code == 200
    f = _esperar(c, fid)
    assert f['id'] == fid and f['estado'] == 'listo' and f['campos']['total'] == 1000      # mismo documento, leido de nuevo
    assert (servidor.FOTOS / f'{fid}.jpg').read_bytes() != antes                           # y con la foto nueva
    # validaciones
    assert c.post(f'/api/facturas/{fid}/sustituir', files={'archivo': ('n.jpg', b'no es imagen', 'image/jpeg')}).status_code == 415
    otro = c.post('/api/facturas', files={'archivo': ('g.jpg', jpg('maroon'), 'image/jpeg')}).json()['id']
    _esperar(c, otro)
    assert c.post(f'/api/facturas/{fid}/sustituir', files={'archivo': ('g.jpg', jpg('maroon'), 'image/jpeg')}).status_code == 409   # esa foto ya es otro documento
    assert c.post(f'/api/facturas/{fid}/estado', json={'estado': 'aplicada'}).status_code == 200
    assert c.post(f'/api/facturas/{fid}/sustituir', files={'archivo': ('n.jpg', jpg('teal'), 'image/jpeg')}).status_code == 409   # lo cargado no se sustituye
    assert c.post('/api/facturas/0000000000000000/sustituir', files={'archivo': ('n.jpg', jpg('teal'), 'image/jpeg')}).status_code == 404
