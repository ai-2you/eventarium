"""Una pausa (descanso, comida…) no lleva ponentes: la API lo impide, no solo el panel."""

from __future__ import annotations

from datetime import timedelta

from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba, crear_miembro, iniciar_sesion
from tests.test_events_public import AHORA, EVENTS, _crear_evento
from tests.test_events_public_ponentes import _al_roster


async def test_una_pausa_rechaza_ponentes_pero_admite_vaciar_la_lista(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-pausa")
    pausa = (
        await cliente.post(
            f"{EVENTS}/{evento['id']}/sessions",
            headers=cabeceras,
            json={
                "session_type": "break",
                "title": "Café",
                "starts_at": (AHORA + timedelta(hours=1)).isoformat(),
                "ends_at": (AHORA + timedelta(hours=2)).isoformat(),
            },
        )
    ).json()
    ponente = await crear_miembro(organizacion, "speaker")
    miembro_evento = await _al_roster(cliente, cabeceras, evento["id"], ponente)
    url = f"{EVENTS}/{evento['id']}/sessions/{pausa['id']}/participants"

    con_ponente = await cliente.put(
        url,
        headers=cabeceras,
        json={
            "expected_updated_at": pausa["updated_at"],
            "participants": [{"event_member_id": miembro_evento, "role_key": "speaker"}],
        },
    )
    vacia = await cliente.put(
        url,
        headers=cabeceras,
        json={"expected_updated_at": pausa["updated_at"], "participants": []},
    )

    assert con_ponente.status_code == 422, con_ponente.text
    assert "pausa" in con_ponente.text
    assert vacia.status_code == 200, vacia.text
