"""Las sesiones caen dentro del rango del evento, sin dejar bloqueadas las que ya
estaban fuera antes de existir la regla."""

from __future__ import annotations

from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_events_public import AHORA, EVENTS, _crear_evento


async def _sesion(cliente: AsyncClient, cabeceras: dict[str, str], event_id: str) -> dict:
    respuesta = await cliente.post(
        f"{EVENTS}/{event_id}/sessions",
        headers=cabeceras,
        json={
            "session_type": "talk",
            "title": "Charla",
            "starts_at": (AHORA + timedelta(hours=1)).isoformat(),
            "ends_at": (AHORA + timedelta(hours=2)).isoformat(),
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return dict(respuesta.json())


async def test_una_sesion_antigua_fuera_de_rango_se_puede_renombrar_pero_no_mover_fuera(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-sesion-antigua")
    sesion = await _sesion(cliente, cabeceras, evento["id"])
    fuera_inicio = AHORA - timedelta(days=5)
    fuera_fin = fuera_inicio + timedelta(hours=1)
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE event_sessions SET starts_at = :i, ends_at = :f WHERE id = :id"),
            {"i": fuera_inicio, "f": fuera_fin, "id": sesion["id"]},
        )
        await session.commit()
    url = f"{EVENTS}/{evento['id']}/sessions/{sesion['id']}"

    renombrada = await cliente.patch(
        url,
        headers=cabeceras,
        json={
            "title": "Charla renombrada",
            "starts_at": fuera_inicio.isoformat(),
            "ends_at": fuera_fin.isoformat(),
        },
    )
    movida_fuera = await cliente.patch(
        url,
        headers=cabeceras,
        json={
            "starts_at": (fuera_inicio - timedelta(days=1)).isoformat(),
            "ends_at": fuera_fin.isoformat(),
        },
    )

    assert renombrada.status_code == 200, renombrada.text
    assert renombrada.json()["title"] == "Charla renombrada"
    assert movida_fuera.status_code == 422
    assert "dentro del rango" in movida_fuera.text
