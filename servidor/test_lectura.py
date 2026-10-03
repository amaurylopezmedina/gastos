import math

import lectura


def caja(x, y, w, h, ang=0.0):
    """Caja del OCR (4 puntos) con su borde superior inclinado `ang` radianes alrededor de (x, y)."""
    c, s = math.cos(ang), math.sin(ang)
    pts = [(0, 0), (w, 0), (w, h), (0, h)]
    return [(x + px * c - py * s, y + px * s + py * c) for px, py in pts]


def renglones(ang):
    res = []
    for i, (etq, imp) in enumerate([('Monto:', '1,000.00'), ('ITBIS:', '180.00'), ('Total:', '1,180.00')]):
        y = 100 + 45 * i
        res.append((caja(100, y + 100 * math.tan(ang) * 0 + math.sin(ang) * 0, 120, 30, ang), etq, 0.9))
        # el importe esta 400 px a la derecha: con inclinacion, queda mas abajo
        res.append((caja(100 + 400 * math.cos(ang), y + 400 * math.sin(ang), 140, 30, ang), imp, 0.9))
    return res


def test_sin_inclinacion_cada_importe_con_su_etiqueta():
    texto, _ = lectura.agrupar(renglones(0.0))
    assert texto.splitlines() == ['Monto:  1,000.00', 'ITBIS:  180.00', 'Total:  1,180.00']


def test_un_ticket_inclinado_se_endereza_antes_de_agrupar():
    for grados in (3, 5, -4, 8):
        texto, _ = lectura.agrupar(renglones(math.radians(grados)))
        assert texto.splitlines() == ['Monto:  1,000.00', 'ITBIS:  180.00', 'Total:  1,180.00'], grados


def test_sin_cajas_no_falla():
    assert lectura.agrupar([]) == ('', 0.0)
