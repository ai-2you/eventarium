"""Sitios cercanos por MCP: añadir, listar, verlos en `ver_evento` y quitarlos."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba
from tests.mcp_test_helpers import _crear_clave, _datos, _herramienta, _rpc
from tests.test_events_categorias import _superadmin


async def _llamar(cliente_mcp: AsyncClient, clave: str, herramienta: str, argumentos: dict) -> dict:
    """Como `_herramienta`, para herramientas con un parámetro llamado `nombre`."""
    respuesta = await _rpc(
        cliente_mcp, clave, "tools/call", {"name": herramienta, "arguments": argumentos}
    )
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()["result"]


async def test_ciclo_completo_de_un_sitio_cercano(
    cliente: AsyncClient, cliente_mcp: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    cabeceras = await _superadmin(cliente, organizacion)
    clave = (await _crear_clave(cliente, cabeceras, scopes=["eventos:leer", "eventos:editar"]))[
        "api_key"
    ]
    ahora = datetime.now(UTC).replace(microsecond=0)
    evento = _datos(
        await _herramienta(
            cliente_mcp,
            clave,
            "crear_evento",
            slug="mcp-cercanos",
            titulo="Con sitios",
            inicio=(ahora + timedelta(days=5)).isoformat(),
            fin=(ahora + timedelta(days=6)).isoformat(),
        )
    )

    sitio = _datos(
        await _llamar(
            cliente_mcp,
            clave,
            "anadir_sitio_cercano",
            {
                "event_id": evento["id"],
                "tipo": "parking",
                "nombre": "Parking Centro",
                "direccion": "Calle Mayor 2",
            },
        )
    )
    invalido = await _llamar(
        cliente_mcp,
        clave,
        "anadir_sitio_cercano",
        {"event_id": evento["id"], "tipo": "other", "nombre": "X"},
    )
    listado = _datos(
        await _herramienta(cliente_mcp, clave, "listar_sitios_cercanos", event_id=evento["id"])
    )
    detalle = _datos(await _herramienta(cliente_mcp, clave, "ver_evento", event_id=evento["id"]))
    quitado = await _herramienta(
        cliente_mcp, clave, "quitar_sitio_cercano", event_id=evento["id"], sitio_id=sitio["id"]
    )

    assert sitio["tipo"] == "parking"
    assert invalido.get("isError")
    assert [s["nombre"] for s in listado] == ["Parking Centro"]
    assert [s["nombre"] for s in detalle["sitios_cercanos"]] == ["Parking Centro"]
    assert not quitado.get("isError")
