from datetime import date

import pytest

import voucher as v

REF = date(2026, 10, 3)
# Voucher INVENTADO con los mismos defectos de OCR que los reales (0<->8 en fecha y monto, «Honto»).
BASE = """TALLER EJEMPLO
MOCA.DO
ID Conercio:000000001234567  AZUL
Comercio-Sur#:  ID Term:00112233
99999999999
Pagos Rapidos
X00*00*0000X9999  Venta
VISA  Visa Credit
Metodo Entrada: Sin Contacto
Procesado:En Linea
{fecha}  14:41:38
Etiqueta:VISA CREDIT
AID:A0000000031010
ARQC:0123456789ABCDEF
Tran #::0000000001  Aprobaclon #:123456
Lote #:000001
{monto}
ITBIS:  180.00
Total:  DOP  {total}
Copia Cliente"""


def voucher(fecha='83/18/26', monto='Honto:  00  1,000.51', total='1,180.00'):
    return BASE.format(fecha=fecha, monto=monto, total=total)


def test_se_reconoce_y_no_se_confunde_con_un_recibo_normal():
    assert v.es_voucher(voucher())
    assert not v.es_voucher('SUPERMERCADO EJEMPLO\nARROZ 250.00\nITBIS 18%  189.00\nTOTAL  1,239.00')
    assert v.leer('SUPERMERCADO EJEMPLO\nTOTAL 10.00') is None


def test_lee_comercio_total_itbis_y_tarjeta():
    campos, problemas = v.leer(voucher(), REF)
    assert campos['comercio'] == 'TALLER EJEMPLO'
    assert campos['total'] == 118000 and campos['itbis'] == 18000
    assert campos['tarjeta'] == '9999' and campos['moneda'] == 'DOP' and campos['fuente'] == 'voucher'
    assert problemas == []


def test_monto_mal_leido_se_deriva_del_total_y_el_itbis():
    campos, problemas = v.leer(voucher(monto='Honto:  00  1,000.51'), REF)     # el OCR leyo 1,000.51 en vez de 1,000.00
    assert campos['subtotal'] == 100000 and 'montos_no_cuadran' not in problemas


def test_fecha_con_0_y_8_confundidos():
    assert v.leer(voucher(fecha='83/18/26'), REF)[0]['fecha'] == '2026-10-03'
    assert v.leer(voucher(fecha='03/10/26'), REF)[0]['fecha'] == '2026-10-03'
    assert v.leer(voucher(fecha='02/10/26'), REF)[0]['fecha'] == '2026-10-02'


def test_fecha_ilegible_propone_la_de_la_foto_a_confirmar():
    campos, problemas = v.leer(voucher(fecha='??/??/??'), REF)
    assert campos['fecha'] == '2026-10-03' and 'fecha_supuesta' in problemas


def test_fecha_muy_lejana_no_se_acepta():
    campos, problemas = v.leer(voucher(fecha='03/10/20'), REF)
    assert 'fecha_supuesta' in problemas


def test_montos_que_no_cuadran_se_marcan():
    campos, problemas = v.leer(voucher(monto='Monto:  DOP  1,000.00', total='1,200.00'), REF)     # 1,000 + 180 != 1,200
    assert 'montos_no_cuadran' in problemas


def test_con_monto_correcto_no_hay_problemas():
    campos, problemas = v.leer(voucher(monto='Monto:  DOP  1,000.00'), REF)
    assert problemas == [] and campos['subtotal'] == 100000


def test_sin_itbis_el_total_es_el_monto():
    t = voucher().replace('ITBIS:  180.00', 'ITBIS:  0.00').replace('Honto:  00  1,000.51', 'Monto:  DOP  1,180.00')
    campos, problemas = v.leer(t, REF)
    assert campos['total'] == 118000 and 'montos_no_cuadran' not in problemas


def test_importes_desalineados_por_un_ticket_inclinado():
    """El OCR puso cada importe en la linea de la etiqueta de abajo (caso real de una foto inclinada)."""
    t = voucher().replace('Honto:  00  1,000.51', 'Lote #:000001  0000  1,000.00').replace('ITBIS:  180.00', 'Honto:  180.00') \
        .replace('Total:  DOP  1,180.00', 'ITBIS:  1,180.00\nTotal:  DOP').replace('Lote #:000001\n', '')
    campos, problemas = v.leer(t, REF)
    assert campos['total'] == 118000 and campos['itbis'] == 18000 and campos['subtotal'] == 100000 and problemas == []


def test_el_triple_aritmetico_no_se_inventa_con_numeros_sueltos():
    assert v._triple('Tran 100.00\nLote 250.00\nTotal 999.00') is None
    assert v._triple('Monto 1,000.00 ITBIS 180.00 Total 1,180.00') == (118000, 18000, 100000)
    assert v._triple('Monto 1,000.00 ITBIS 300.00 Total 1,300.00') is None          # 300 no es el 18 % de 1,000
