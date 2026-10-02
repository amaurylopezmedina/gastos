from datetime import date
import verificar as v

HOY = date(2026, 10, 2)
TXT = "AUTORREPUESTO EJEMPLO\nPORTA ESCOBILLAS 1,500.00\nMANO DE OBRA 2,000.00\nTOTAL 3,500.00"
BASE = {'comercio': 'Autorrepuesto Ejemplo', 'fecha': '2026-10-02', 'rubro': 'mant_veh',
        'total': 350000, 'lineas': [{'desc': 'a', 'cents': 150000}, {'desc': 'b', 'cents': 200000}]}


def test_importes():
    assert v.a_centimos('1,234.56') == 123456
    assert v.a_centimos('1.234,56') == 123456
    assert v.a_centimos('RD$ 3,500.00') == 350000
    assert v.a_centimos('1234') == 123400
    assert v.a_centimos('12,5') == 1250
    assert v.a_centimos('1.234') == 123400 or v.a_centimos('1.234') == 123    # ambiguo; no debe romper
    assert v.a_centimos(None) is None and v.a_centimos('abc') is None


def test_cuadra():
    assert v.verificar(BASE, TXT, 0.95, HOY) == []


def test_total_que_el_ocr_no_vio():
    mal = dict(BASE, total=360000)
    assert 'total_no_esta_en_el_texto' in v.verificar(mal, TXT, 0.95, HOY)


def test_lineas_no_suman():
    mal = dict(BASE, lineas=[{'desc': 'a', 'cents': 150000}])
    assert 'lineas_no_suman' in v.verificar(mal, TXT, 0.95, HOY)


def test_itbis_incluido_aparte():
    campos = dict(BASE, total=118000, itbis=18000, lineas=[{'desc': 'a', 'cents': 100000}])
    assert v.verificar(campos, "TOTAL 1,180.00", 0.9, HOY) == []


def test_fecha_futura_o_vieja():
    assert 'fecha_invalida' in v.verificar(dict(BASE, fecha='2026-12-01'), TXT, 0.95, HOY)
    assert 'fecha_invalida' in v.verificar(dict(BASE, fecha='2020-01-01'), TXT, 0.95, HOY)
    assert 'fecha_invalida' in v.verificar(dict(BASE, fecha='02/10/2026'), TXT, 0.95, HOY)


def test_ocr_poco_seguro_y_sin_comercio():
    p = v.verificar(dict(BASE, comercio=' '), TXT, 0.5, HOY)
    assert 'ocr_poco_seguro' in p and 'sin_comercio' in p


def test_rubro_inventado_o_no_clasificable_por_la_ia():
    assert 'rubro_desconocido' in v.verificar(dict(BASE, rubro='viajes'), TXT, 0.95, HOY)
    assert 'rubro_desconocido' in v.verificar(dict(BASE, rubro='sueldo'), TXT, 0.95, HOY)    # ingreso
    assert 'rubro_desconocido' in v.verificar(dict(BASE, rubro='cuotas'), TXT, 0.95, HOY)    # deudas
    assert 'rubro_desconocido' in v.verificar(dict(BASE, rubro=None), TXT, 0.95, HOY)


def test_total_dentro_de_otro_numero_no_cuenta():
    assert not v.aparece_en_texto(350000, "REF 13,500.001 y 93,500.00")


def test_itbis_que_el_modelo_no_leyo_pero_el_texto_menciona():
    campos = dict(BASE, total=123900, lineas=[{'desc': 'a', 'cents': 105000}])
    assert v.verificar(campos, "ITBIS 18%  189.00\nTOTAL 1,239.00", 0.9, HOY) == []
    # sin la palabra ITBIS en el texto, una diferencia asi no se perdona
    assert 'lineas_no_suman' in v.verificar(campos, "TOTAL 1,239.00", 0.9, HOY)
    # y una diferencia que no es 18 %/16 %/10 % tampoco
    campos2 = dict(BASE, total=123950, lineas=[{'desc': 'a', 'cents': 105000}])
    assert 'lineas_no_suman' in v.verificar(campos2, "ITBIS\nTOTAL 1,239.50", 0.9, HOY)


def test_fechas_dominicanas():
    assert v.normalizar_fecha('01/10/2026') == '2026-10-01'
    assert v.normalizar_fecha('1-10-26') == '2026-10-01'
    assert v.normalizar_fecha('2026-10-01') == '2026-10-01'


def test_un_ingreso_nunca_pasa_solo():
    assert 'tipo_a_confirmar' in v.verificar(dict(BASE, tipo='ingreso'), TXT, 0.95, HOY)
    assert v.verificar(dict(BASE, tipo='gasto'), TXT, 0.95, HOY) == []
