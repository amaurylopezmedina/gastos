"""Lee el texto de la FOTO DE UNA TARJETA y devuelve solo lo imprescindible: banco, marca, tipo y los 4 ultimos digitos.

Seguridad: la foto trae el numero completo, la fecha de vencimiento y a veces el CVV. Aqui nunca se devuelve ni se
guarda nada de eso: solo los 4 ultimos digitos. La imagen no se escribe en disco (ver el endpoint) y el texto del OCR
no sale de esta funcion."""
import re

BANCOS = [
    ('BHD', r'\bbhd\b'), ('Scotiabank', r'scotia'), ('Popular', r'banco popular|\bpopular\b'),
    ('Banreservas', r'banreservas|\breservas\b'), ('Promerica', r'promerica'), ('Santa Cruz', r'santa cruz'),
    ('Caribe', r'banco caribe|\bcaribe\b'), ('Vimenca', r'vimenca'), ('Lafise', r'lafise'), ('BDI', r'\bbdi\b'),
    ('APAP', r'\bapap\b'), ('Banesco', r'banesco'), ('Ademi', r'ademi'), ('Alaver', r'alaver'), ('ACAP', r'\bacap\b'),
]
MARCAS = [
    ('American Express', r'american express|\bamex\b'), ('Mastercard', r'master ?card|\bmaestro\b'),
    ('Visa', r'\bvisa\b'), ('Discover', r'discover'),
]
_DIGITO = str.maketrans({'O': '0', 'o': '0', 'D': '0', 'I': '1', 'l': '1', '|': '1', 'S': '5', 'B': '8'})


def _ultimos4(texto):
    # 1) numero completo (15 o 16 digitos, con espacios o guiones): el OCR confunde letras con digitos
    for linea in texto.splitlines():
        crudo = re.sub(r'[\s\-]', '', linea)
        if 15 <= len(crudo) <= 19 and re.fullmatch(r'[\dOoDIl|SB]+', crudo):
            digitos = crudo.translate(_DIGITO)
            if 15 <= len(digitos) <= 16:
                return digitos[-4:]
    # 2) numero ya enmascarado: •••• 1234, **** 1234, XXXX 1234
    m = re.search(r'(?:[•*xX·]{2,}[\s\-]*){1,4}(\d{4})\b', texto)
    if m:
        return m.group(1)
    # 3) cuatro grupos de 4 aunque el OCR los haya separado en trozos
    m = re.search(r'(\d{4})[\s\-]+(\d{4})[\s\-]+(\d{4})[\s\-]+(\d{3,4})\b', texto.translate(_DIGITO))
    return m.group(4)[-4:] if m else None


def leer(texto):
    """-> {'ultimos4', 'marca', 'banco', 'tipo'} (cada valor puede ser None)."""
    t = (texto or '').lower()
    def primero(lista):
        return next((n for n, rx in lista if re.search(rx, t)), None)
    tipo = 'credito' if re.search(r'cr[eé]dit', t) else 'debito' if re.search(r'd[eé]bit', t) else None
    return {'ultimos4': _ultimos4(texto or ''), 'marca': primero(MARCAS), 'banco': primero(BANCOS), 'tipo': tipo}
