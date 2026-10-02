"""Control de acceso. Falla cerrado.

Todo lo que llega por el tunel lleva cabeceras Cf-*; eso exige un JWT valido de Cloudflare Access
(firma, audiencia y caducidad). Lo que llega directo a 127.0.0.1 sin esas cabeceras es local y
pasa (pruebas, scripts). Configuracion en ~/finanzas/config.env: ACCESS_TEAM y ACCESS_AUD."""
import os
import jwt
from fastapi import HTTPException, Request

_cliente = None


def _jwks(equipo):
    global _cliente
    if _cliente is None:
        _cliente = jwt.PyJWKClient(f'https://{equipo}/cdn-cgi/access/certs', cache_keys=True, lifespan=3600)
    return _cliente


def exigir(request: Request):
    h = request.headers
    por_tunel = any(k in h for k in ('cf-connecting-ip', 'cf-ray', 'cf-access-jwt-assertion'))
    if not por_tunel:
        return
    equipo, aud = os.environ.get('ACCESS_TEAM'), os.environ.get('ACCESS_AUD')
    token = h.get('cf-access-jwt-assertion')
    if not (equipo and aud and token):
        raise HTTPException(403, 'acceso no autorizado')
    try:
        clave = _jwks(equipo).get_signing_key_from_jwt(token).key
        jwt.decode(token, clave, algorithms=['RS256'], audience=aud, issuer=f'https://{equipo}',
                   options={'require': ['exp', 'iat', 'aud', 'iss']})
    except Exception:
        raise HTTPException(403, 'acceso no autorizado')
