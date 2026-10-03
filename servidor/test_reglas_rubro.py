import pytest
import reglas_rubro as r
import rubros


def test_todas_las_reglas_apuntan_a_rubros_que_existen_y_que_la_ia_puede_usar():
    for rubro, _ in r.REGLAS:
        assert rubro in rubros.IDS_GASTO, rubro


@pytest.mark.parametrize('comercio,esperado', [
    ('Texaco Moca', 'combustible'), ('SHELL AUTOPISTA', 'combustible'),
    ('Supermercado Ejemplo', 'super'), ('JUMBO MOCA', 'super'), ('La Sirena', 'super'),
    ('Burger King', 'comerfuera'), ('Pizzeria Italia', 'comerfuera'),
    ('Farmacia Carol', 'farmacia'), ('GBC', 'farmacia'),
    ('Edenorte Dominicana', 'luz'), ('Claro Dominicana', 'internet'),
    ('NETFLIX.COM', 'suscripciones'), ('Apple.com/bill', 'suscripciones'),
    ('Autorrepuesto Neno', 'mant_veh'), ('Colmado Los Hermanos', 'colmado'),
    ('UTESA', 'colegio'), ('ESSO LAS PALMAS', 'combustible'), ('GARDEN FOOD PARK', 'comerfuera'), ('COFFEY', 'comerfuera'),
    ('DECOPLAX', 'reparaciones'), ('TRAINING MOCA', 'ocio'), ('Clínica Corominas', 'consultas'), ('Ferretería Ochoa', 'reparaciones'),
])
def test_comercios_conocidos(comercio, esperado):
    assert r.por_palabras(comercio) == esperado


def test_mira_las_lineas_si_el_comercio_no_dice_nada():
    assert r.por_palabras('Negocio Ejemplo SRL', ['GASOIL OPTIMO 10 GAL']) == 'combustible'


def test_lo_desconocido_no_se_adivina():
    assert r.por_palabras('Servicios Generales XYZ', ['ARTICULO 1']) is None
    assert r.por_palabras('', [], '') is None


def test_pagar_otra_tarjeta_es_deuda_no_gasto():
    assert r.para_extracto('SCOTIABANK COBRANZAS TARJ') == 'cuotas'
    assert r.para_extracto('PAGO TARJETA BHD') == 'cuotas'
    assert r.para_extracto('JUMBO MOCA') == 'super'
    assert r.para_extracto('AGRORI') is None
