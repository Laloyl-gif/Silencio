"""Accès HTTP (bibliothèque standard seulement, pour tourner partout : PC et téléphone)."""
import gzip
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request

AGENT = "Silencio/1 (+https://github.com)"
_CTX = None


class ErreurHTTP(Exception):
    def __init__(self, code, message="", corps=b"", entetes=None):
        super().__init__(f"HTTP {code} {message}".strip())
        self.code, self.corps, self.entetes = code, corps, dict(entetes or {})


class HorsLigne(Exception):
    pass


def _ctx():
    global _CTX
    if _CTX is None:
        _CTX = ssl.create_default_context()
        try:
            import certifi  # présent avec Chaquopy si installé ; sinon les certificats du système
            _CTX.load_verify_locations(certifi.where())
        except Exception:  # noqa: BLE001
            pass
    return _CTX


def requete(url, methode="GET", params=None, corps=None, entetes=None, delai=15, brut=False):
    """Envoie une requête. Renvoie le JSON décodé (ou les octets si brut=True)."""
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(
            {k: v for k, v in params.items() if v is not None}, doseq=True)
    h = {"User-Agent": AGENT, "Accept-Encoding": "gzip"}
    h.update(entetes or {})
    donnees = None
    if corps is not None:
        if isinstance(corps, (bytes, bytearray)):
            donnees = bytes(corps)
        else:
            donnees = json.dumps(corps).encode("utf-8")
            h.setdefault("Content-Type", "application/json;charset=utf-8")
    req = urllib.request.Request(url, data=donnees, method=methode, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=delai, context=_ctx() if url.startswith("https") else None) as r:
            contenu = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                contenu = gzip.decompress(contenu)
    except urllib.error.HTTPError as e:
        try:
            c = e.read()
            if e.headers.get("Content-Encoding") == "gzip":
                c = gzip.decompress(c)
        except Exception:  # noqa: BLE001
            c = b""
        raise ErreurHTTP(e.code, e.reason, c, {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}) from None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise HorsLigne(str(e)) from None
    if brut:
        return contenu
    if not contenu:
        return {}
    return json.loads(contenu.decode("utf-8"))
