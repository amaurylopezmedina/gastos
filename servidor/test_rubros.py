import rubros


def test_catalogo_completo():
    assert len(rubros.RUBROS) == 59 and len(set(rubros.IDS)) == 59
    assert len(rubros.GRUPOS) == 10
    assert {r['g'] for r in rubros.RUBROS} == set(rubros.GRUPOS)


def test_categorias_existen_en_la_app():
    cats = {'comida', 'super', 'transpor', 'casa', 'ocio', 'salud', 'ropa', 'subs', 'banco', 'otros'}
    assert set(rubros.CATEGORIA.values()) <= cats


def test_la_ia_no_clasifica_ingresos_ni_deudas():
    assert 'sueldo' not in rubros.IDS_GASTO and 'cuotas' not in rubros.IDS_GASTO
    assert 'super' in rubros.IDS_GASTO and 'luz' in rubros.IDS_GASTO
