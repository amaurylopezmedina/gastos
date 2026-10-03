import tarjeta as t

# Textos INVENTADOS con la forma de lo que lee el OCR en una tarjeta.
def test_numero_completo_y_marca():
    r = t.leer('BANCO EJEMPLO\nVISA\nPLATINUM\n4111 1111 1111 9876\nVALID THRU 12/29\nJUAN EJEMPLO PEREZ')
    assert r['ultimos4'] == '9876' and r['marca'] == 'Visa' and r['tipo'] is None


def test_banco_y_tipo():
    r = t.leer('BHD\nDEBITO\n5555 5555 5555 4321\nMastercard')
    assert r['banco'] == 'BHD' and r['marca'] == 'Mastercard' and r['tipo'] == 'debito' and r['ultimos4'] == '4321'
    assert t.leer('Scotiabank Credito\n4000-0000-0000-0002')['banco'] == 'Scotiabank'


def test_amex_de_15_digitos():
    assert t.leer('AMERICAN EXPRESS\n3782 822463 10005')['ultimos4'] == '0005'


def test_ocr_confunde_letras_con_digitos():
    assert t.leer('4OO0 OOOO 0OOO 1234')['ultimos4'] == '1234'


def test_numero_enmascarado():
    assert t.leer('VISA\n•••• •••• •••• 7777')['ultimos4'] == '7777'
    assert t.leer('XXXX XXXX XXXX 4242')['ultimos4'] == '4242'


def test_no_devuelve_nada_mas_que_lo_imprescindible():
    r = t.leer('VISA\n4111 1111 1111 9876\n12/29\nCVV 123\nJUAN EJEMPLO PEREZ')
    assert set(r) == {'ultimos4', 'marca', 'banco', 'tipo'}
    blob = ' '.join(str(v) for v in r.values())
    for secreto in ('4111', '1111', '12/29', '123', 'JUAN', 'PEREZ'):
        assert secreto not in blob


def test_sin_tarjeta():
    assert t.leer('FACTURA 123\nTOTAL 1,000.00')['ultimos4'] is None
    assert t.leer('')['marca'] is None
