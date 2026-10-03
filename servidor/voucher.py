"""Lector de comprobantes de tarjeta (voucher del POS: Azul, Cardnet, Visanet...).

Es determinista y no usa el modelo. El OCR confunde 0 con 8 en esa tipografia (fecha y montos), asi que nada se
da por bueno sin aritmetica:
  - Monto + ITBIS (+ propina) = Total, o
  - el ITBIS es el 18 % de la base (Total - ITBIS - propina), lo que valida el Total aunque el «Monto» se lea mal.
La fecha se corrige probando los cambios 0<->8 y eligiendo la fecha valida mas cercana a la de la foto."""
import itertools
import re
from datetime import date, timedelta

from verificar import a_centimos

PISTAS = ('aprobac', 'lote', 'arqc', 'aid:', 'metodo entrada', 'copia cliente', 'etiqueta', 'id term', 'comercio-sur', 'venta')
_IMPORTE = re.compile(r'(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})')


def es_voucher(texto):
    t = (texto or '').lower()
    return 'total' in t and 'itbis' in t and sum(1 for p in PISTAS if p in t) >= 3


def _importe(linea):
    """Ultimo importe de la linea (el OCR a veces pone un 'DOP' o '00' antes)."""
    m = _IMPORTE.findall(linea.replace('O', '0').replace('o', '0'))
    return a_centimos(m[-1]) if m else None


def _triple(texto):
    """Busca en TODO el texto tres importes donde dos suman el tercero y uno es el 18 % de la base (Monto + ITBIS = Total).
    No depende de en que linea haya caido cada numero, asi que sobrevive a un OCR desalineado. -> (total, itbis, base) o None."""
    importes = sorted({a_centimos(m) for m in _IMPORTE.findall(texto.replace('O', '0').replace('o', '0'))} - {None, 0})
    mejor = None
    for z in importes:
        for x in importes:
            y = z - x
            if y < x or y not in importes:
                continue
            base, itbis = y, x                                  # x <= y: el ITBIS es el menor
            if abs(round(base * 0.18) - itbis) <= 2 and (mejor is None or z > mejor[0]):
                mejor = (z, itbis, base)
    return mejor


def _linea(texto, patron):
    for l in texto.splitlines():
        if re.match(patron, l.strip(), re.I):
            return l
    return None


def _tarjeta(texto):
    for tok in re.findall(r'[Xx*][Xx*\d]{6,}', texto):
        m = re.search(r'(\d{4})$', tok)
        if m:
            return m.group(1)
    return None


def _fecha(texto, ref):
    """-> (iso, supuesta). Prueba 0<->8 en cada digito y elige la valida mas cercana a `ref`."""
    m = re.search(r'\b([0-9OoBb]{2})/([0-9OoBb]{2})/([0-9OoBb]{2,4})\b', texto)
    if m:
        crudo = [c for c in '/'.join(m.groups()) if c != '/']
        opciones = []
        for i, ch in enumerate(crudo):
            alt = {'0': ('0', '8'), '8': ('8', '0'), 'O': ('0',), 'o': ('0',), 'B': ('8',), 'b': ('8',)}.get(ch, (ch,))
            opciones.append(alt)
        mejor = None
        for combo in itertools.islice(itertools.product(*opciones), 256):
            d, mo, a = ''.join(combo[:2]), ''.join(combo[2:4]), ''.join(combo[4:])
            if not (d.isdigit() and mo.isdigit() and a.isdigit()):
                continue
            a = int(a) + 2000 if len(a) == 2 else int(a)
            try:
                f = date(a, int(mo), int(d))
            except ValueError:
                continue
            if not (ref - timedelta(days=10) <= f <= ref + timedelta(days=1)):
                continue
            cambios = sum(1 for x, y in zip(combo, crudo) if x != y)
            clave = (abs((f - ref).days), cambios)
            if mejor is None or clave < mejor[0]:
                mejor = (clave, f)
        if mejor:
            return mejor[1].isoformat(), False
    return ref.isoformat(), True            # no se pudo leer: se propone la fecha de la foto, a confirmar


def leer(texto, ref=None):
    """-> (campos, problemas) o None si no parece un voucher."""
    if not es_voucher(texto):
        return None
    ref = ref or date.today()
    problemas = []
    total = _importe(_linea(texto, r'total\b') or '')
    itbis = _importe(_linea(texto, r'itbis\b') or '')
    prop = _importe(_linea(texto, r'propina\b') or '') or 0
    monto = _importe(_linea(texto, r'[mhn]o[nm]to\b|sub ?total\b') or '')
    t3 = _triple(texto)
    if t3 and not prop:                          # tres importes que suman exactamente y con ITBIS del 18 %: eso manda sobre las etiquetas
        total, itbis, monto = t3
    if not total or total <= 0:
        problemas.append('total_invalido')
    else:
        itbis = itbis or 0
        base = total - itbis - prop
        coherente = itbis > 0 and abs(round(base * 0.18) - itbis) <= 2          # ITBIS dominicano: 18 %
        if monto is not None and monto + itbis + prop == total:
            pass
        elif coherente:
            monto = base                      # el «Monto» se leyo mal pero Total e ITBIS cuadran entre si: se deriva
        elif itbis == 0 and monto in (None, total):
            monto = total                     # comprobante sin ITBIS
        else:
            problemas.append('montos_no_cuadran')
    fecha, supuesta = _fecha(texto, ref)
    if supuesta:
        problemas.append('fecha_supuesta')
    primera = next((l.strip() for l in texto.splitlines() if re.search(r'[A-Za-z]{3}', l) and not re.match(r'(?i)\s*(id|comercio|pagos|venta|visa)', l)), '')
    campos = {
        'comercio': primera[:60], 'fecha': fecha, 'total': total, 'itbis': itbis or None, 'subtotal': monto,
        'propina': prop or None, 'tarjeta': _tarjeta(texto), 'moneda': 'USD' if re.search(r'\bUSD\b', texto) else 'DOP',
        'lineas': [], 'tipo': 'gasto', 'ncf': None, 'fuente': 'voucher',
    }
    if campos['moneda'] != 'DOP':
        problemas.append('moneda_extranjera')
    return campos, problemas
