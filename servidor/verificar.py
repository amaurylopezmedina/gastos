"""Comprobaciones aritmeticas de una factura leida. Todo en centimos enteros.

La IA lee; este modulo comprueba. Nada que no cuadre pasa a «listo»."""
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

import rubros


def a_centimos(valor):
    """'1,234.56' / '1.234,56' / 1234.5 / '1234' -> centimos enteros, o None."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        d = Decimal(str(valor))
    else:
        s = re.sub(r"[^\d.,-]", "", str(valor))
        if not s or not re.search(r"\d", s):
            return None
        ult_p, ult_c = s.rfind('.'), s.rfind(',')
        if ult_p >= 0 and ult_c >= 0:                 # ambos: el ultimo es el decimal
            dec = '.' if ult_p > ult_c else ','
            s = s.replace(',' if dec == '.' else '.', '').replace(dec, '.')
        elif ult_c >= 0:                              # solo coma
            s = s.replace(',', '.') if len(s) - ult_c - 1 in (1, 2) else s.replace(',', '')
        elif ult_p >= 0 and len(s) - ult_p - 1 == 3 and s.count('.') > 1:
            s = s.replace('.', '')
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None
    try:
        return int((d * 100).to_integral_value())
    except InvalidOperation:
        return None


def formas_del_importe(cents):
    """Como puede aparecer un importe en el texto del OCR."""
    ent, dec = divmod(abs(cents), 100)
    miles_c = f"{ent:,}".replace(',', '.')
    return {
        f"{ent:,}.{dec:02d}",          # 1,234.56
        f"{ent}.{dec:02d}",            # 1234.56
        f"{miles_c},{dec:02d}",        # 1.234,56
        f"{ent},{dec:02d}",            # 1234,56
    }


def aparece_en_texto(cents, texto):
    plano = re.sub(r"(?<=\d)\s+(?=[\d.,]\d)", "", texto or '')   # "1 234.56"
    for f in formas_del_importe(cents):
        if re.search(r"(?<![\d.,])" + re.escape(f) + r"(?![\d])", plano):
            return True
    return False


def normalizar_fecha(texto):
    """'01/10/2026', '1-10-26', '2026-10-01' -> 'YYYY-MM-DD' (dia/mes/ano, como en RD)."""
    s = str(texto or '').strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return s
    m = re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})", s)
    if not m:
        return s
    d, mo, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
    a += 2000 if a < 100 else 0
    return f"{a:04d}-{mo:02d}-{d:02d}"


def impuestos_implicitos(suma, total, texto):
    """Linea de ITBIS (18 % o 16 %) y/o propina legal (10 %) que el modelo no leyo pero el texto menciona."""
    t = (texto or '').lower()
    hay_itbis, hay_prop = 'itbis' in t or 'impuesto' in t, 'propina' in t or 'servicio' in t
    for itbis in ((0.18, 0.16) if hay_itbis else (0,)):
        for prop in ((0.10, 0) if hay_prop else (0,)):
            for base in (suma, ):
                if abs(round(base * (1 + itbis + prop)) - total) <= 1:
                    return True
    return False


def fecha_valida(texto, hoy=None):
    hoy = hoy or date.today()
    try:
        d = datetime.strptime(str(texto), "%Y-%m-%d").date()
    except ValueError:
        return None
    if d > hoy + timedelta(days=1) or d < hoy - timedelta(days=730):
        return None
    return d


def verificar(campos, texto_ocr, confianza, hoy=None):
    """-> lista de problemas (vacia = cuadra). Cada problema es un codigo corto."""
    p = []
    total = campos.get('total')
    if not isinstance(total, int) or total <= 0:
        p.append('total_invalido')
    elif not aparece_en_texto(total, texto_ocr):
        p.append('total_no_esta_en_el_texto')

    if not (campos.get('comercio') or '').strip():
        p.append('sin_comercio')
    if fecha_valida(campos.get('fecha'), hoy) is None:
        p.append('fecha_invalida')
    if campos.get('rubro') not in rubros.IDS_GASTO:      # la categoria de la app se deduce del rubro
        p.append('rubro_desconocido')
    if campos.get('tipo', 'gasto') != 'gasto':        # un ingreso lo decide una persona, nunca la IA sola
        p.append('tipo_a_confirmar')
    if confianza is not None and confianza < 0.80:
        p.append('ocr_poco_seguro')

    lineas = [l.get('cents') for l in campos.get('lineas') or []]
    if lineas and all(isinstance(c, int) for c in lineas) and isinstance(total, int):
        suma = sum(lineas)
        itbis = campos.get('itbis') or 0
        propina = campos.get('propina') or 0
        subtotal = campos.get('subtotal')
        cuadra = {suma, suma + itbis, suma + itbis + propina, suma + propina}
        if isinstance(subtotal, int):
            cuadra |= {subtotal, subtotal + itbis, subtotal + itbis + propina}
        if total not in cuadra and not impuestos_implicitos(suma, total, texto_ocr):
            p.append('lineas_no_suman')
    return p
