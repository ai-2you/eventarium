"""Helpers para mockear la descarga por URL de `media_service.subir_desde_url`
(SSRF: resolución DNS + streaming de httpx) — compartido por los tests de
subida de medios por URL, asignación de portada de evento y la herramienta
MCP `asignar_portada_evento`, todos los que pasan por esa misma función."""

from __future__ import annotations

import socket
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

import httpx

#: Host de prueba que `ssrf.py` resuelve a una IP pública genuina en vez de
#: la real — ver `_resolucion_dns_publica_falsa`.
HOST_DE_PRUEBA = "ejemplo-de-prueba.invalid"
_GETADDRINFO_REAL = socket.getaddrinfo


def _resolucion_dns_publica_falsa(host: str, *args: object, **kwargs: object) -> list[tuple]:
    """Sustituye `socket.getaddrinfo` SOLO para `HOST_DE_PRUEBA` — es un
    patch sobre el módulo `socket` global (`ssrf.py` hace `import socket`,
    no una copia), así que debe reenviar cualquier otro host (el almacén
    local en `localhost`, p. ej.) a la función real o rompe subidas que no
    tienen nada que ver con esta prueba. Un host de prueba resuelve a una IP
    pública genuina — los rangos TEST-NET (203.0.113.0/24 y similares)
    cuentan como `is_private` en el propio módulo `ipaddress`, así que no
    sirven aquí."""
    if host == HOST_DE_PRUEBA:
        return [(2, 1, 6, "", ("93.184.216.34", 0))]
    return _GETADDRINFO_REAL(host, *args, **kwargs)


class _StreamFalso:
    """Imita lo que devuelve `httpx.AsyncClient.stream(...)`: un gestor de
    contexto asíncrono cuyo `__aenter__` da la respuesta ya preparada."""

    def __init__(self, respuesta: httpx.Response) -> None:
        self._respuesta = respuesta

    async def __aenter__(self) -> httpx.Response:
        return self._respuesta

    async def __aexit__(self, *_exc_info: object) -> bool:
        return False


@contextmanager
def mock_descarga_por_url(
    *, status_code: int = 200, content: bytes = b"", headers: dict[str, str] | None = None
) -> Any:
    """Mockea a la vez la resolución DNS (SSRF) y el streaming de httpx que
    usa `media_service.subir_desde_url` — lo necesario para que un test
    ejercite esa función sin tocar la red de verdad."""
    respuesta = httpx.Response(
        status_code,
        content=content,
        headers=headers or {},
        request=httpx.Request("GET", "https://x"),
    )
    with (
        patch("app.modules.media.ssrf.socket.getaddrinfo", new=_resolucion_dns_publica_falsa),
        patch(
            "httpx.AsyncClient.stream",
            new=lambda self, *args, **kwargs: _StreamFalso(respuesta),
        ),
    ):
        yield
