"""Un ponente (solo `organizations:read`) no puede usar las pantallas de gestión
del panel aunque escriba la URL o llame a la API a mano: el menú y los guards
del panel son comodidad; la autoridad es el backend."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba, iniciar_sesion_como

ENDPOINTS_DE_GESTION = [
    "/api/v1/organizations/me/members",
    "/api/v1/roles",
    "/api/v1/events",
    "/api/v1/organizations/me/sponsor-tiers",
    "/api/v1/organizations/me/ai-settings",
    "/api/v1/users/me/mcp-connections",
]


@pytest.mark.parametrize("ruta", ENDPOINTS_DE_GESTION)
async def test_un_ponente_recibe_403_en_la_gestion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, ruta: str
) -> None:
    _, cabeceras = await iniciar_sesion_como(cliente, organizacion, "speaker")

    respuesta = await cliente.get(ruta, headers=cabeceras)

    assert respuesta.status_code == 403, respuesta.text


async def test_un_ponente_si_puede_ver_su_cuenta(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion_como(cliente, organizacion, "speaker")

    respuesta = await cliente.get("/api/v1/users/me", headers=cabeceras)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["permissions"] == ["organizations:read"]
    assert respuesta.json()["roles"] == ["speaker"]
