"""Rubro por palabras clave de comercios dominicanos. Va ANTES del modelo: es determinista, instantaneo
y no se equivoca con lo que reconoce. Lo que el usuario corrige en la app (tabla reglas_rubro) manda sobre esto.
Se evalua en orden: la primera coincidencia gana, asi que lo mas especifico va arriba."""
import re
import unicodedata

REGLAS = [
    ('combustible', r'texaco|\bshell\b|\besso\b|sunix|\bisla\b|total ?energies|gasolinera|estaci[o]n de servicio|combustible|gasoil|\bglp\b|\bgnv\b'),
    ('suscripciones', r'netflix|spotify|apple\.com|itunes|icloud|google ?(one|play|\*)|youtube|amazon ?prime|prime video|microsoft|disney|hbo|canva|openai|chatgpt|anthropic|claude|cloudflare|github|dropbox|zoom'),
    ('luz', r'edenorte|edesur|edeeste|\beden\b|distribuidora de electricidad'),
    ('internet', r'\bclaro\b|altice|\bwind\b|\bviva\b|internet|cable ?(tv|net)?|telefon'),
    ('agua', r'\bcaasd\b|\bcorasan\b|\bcoraaplata\b|acueducto|agua potable'),
    ('farmacia', r'farmaci|\bcarol\b|\bgbc\b|hidalgos|droguer|fahrmacia'),
    ('ars', r'senasa|\bars\b|humano seguros|universal seguros|palic|mapfre salud'),
    ('consultas', r'laborator|cl[i]nica|centro m[e]dico|hospital|consulta m[e]dica|radiolog|sonograf'),
    ('dentista', r'dentis|odontolog|ortodon'),
    ('optica', r'[o]ptica|lentes|oftalm'),
    ('colegio', r'utesa|universidad|colegio|pucmm|unibe|\bintec\b|matr[i]cula|inscripci[o]n|mensualidad escolar'),
    ('seguro_veh', r'seguro (de )?(veh[i]culo|auto|carro)|seguros? (universal|mapfre|la colonial)'),
    ('mant_veh', r'autorrepuesto|repuesto|taller|mec[a]nic|lubricentro|cambio de aceite|frenos|bater[i]a|alineaci[o]n'),
    ('neumaticos', r'neum[a]tic|\bgomas?\b|gomera'),
    ('lavado', r'autolavado|lavado de|car ?wash|parqueo|parking|estacionamiento'),
    ('transporte', r'aerodom|avansi|uber|indriver|\bpasaje|aerol[i]nea|aeropuerto|\bcaribe tours|metro de santo domingo|teleferico'),
    ('marbete', r'marbete|inspecci[o]n t[e]cnica|\bintrant\b|\bdgii\b.*veh'),
    ('multas', r'\bmulta\b|\bamet\b|digesett'),
    ('super', r'jumbo|la sirena|\bsirena\b|supermerc|\bpola\b|plaza lama|coopcibao|carrefour'),
    ('comerfuera', r'burger ?king|mcdonald|\bkfc\b|pizz|domino|pollo|restaurant|caf[e]\b|cafeter|food park|garden food|coffe[ey]|wendy|subway|helader|pica ?pollo|pedidosya|uber ?eats|\bbar\b|parrilla|sushi|tacos'),
    ('colmado', r'colmado|minimarket|mini ?market|\bbodega\b'),
    ('reparaciones', r'ikea|decopla|decorac|ferreter|bellon|ochoa|home ?center|pinturas|plomer|electricista|el[e]ctric[ao]s? |construc'),
    ('ropa', r'\bzara\b|\bnike\b|adidas|boutique|calzado|zapat|\bropa\b|tienda de ropa|carolina herrera|\bh ?& ?m\b|american eagle'),
    ('cuidado', r'barber[i]a|peluquer|sal[o]n de belleza|spa\b|uñas|nails|cosm[e]tic'),
    ('ocio', r'gimnasio|\bgym\b|training|fitness|crossfit|cine|cinemas|teatro|casino|discoteca|\bclub\b|bowling|parque|concierto|boleter[i]a|tickets'),
    ('mascotas', r'veterinar|mascota|pet ?shop|petco'),
    ('tecnologia', r'\bpc ?gamer|computadora|celular|iphone|samsung|tecnolog|electr[o]nic|\bcompuoffice|\bcecomsa'),
    ('iglesia', r'iglesia|diezmo|ofrenda|donaci'),
    ('honorarios', r'contador|abogado|notar[i]o|honorarios'),
    ('impuestos', r'\bdgii\b|\btss\b|impuesto|\bafp\b|\binfotep\b'),
]
_COMPILADAS = [(rubro, re.compile(p, re.I)) for rubro, p in REGLAS]


# Pagar OTRA tarjeta o prestamo con esta tarjeta: es deuda, no gasto de vida (rubro de Deudas).
PAGO_DE_DEUDA = re.compile(r'cobranzas? ?tarj|pago (de )?tarjeta|pago tarj|pago prestamo|pago de prestamo', re.I)


def quitar_acentos(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode('ascii')


def para_extracto(descripcion):
    """Rubro de una linea de estado de cuenta: pago de deuda o palabras clave; None si no se sabe."""
    if PAGO_DE_DEUDA.search(quitar_acentos(descripcion)):
        return 'cuotas'
    return por_palabras(descripcion)


def por_palabras(comercio, descripciones=(), texto=''):
    """-> rubro o None. Mira primero el comercio; luego las lineas; luego el principio del texto."""
    for fuente in (comercio, ' '.join(descripciones), (texto or '')[:500]):
        t = quitar_acentos(fuente).lower()
        if not t.strip():
            continue
        for rubro, rx in _COMPILADAS:
            if rx.search(t):
                return rubro
    return None
