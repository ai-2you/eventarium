"""Participaciones del roster en las sesiones de un evento, en una consulta, para
avisar de solapes desde el panel."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba, crear_miembro, iniciar_sesion
from tests.test_events_public import EVENTS, _crear_evento
from tests.test_events_public_ponentes import _al_roster
from tests.test_events_sesiones_rango import _sesion


async def test_lista_quien_esta_en_que_sesion_y_a_que_hora(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    otra_organizacion: OrganizacionDePrueba,
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-participaciones")
    sesion = await _sesion(cliente, cabeceras, evento["id"])
    ponente = await crear_miembro(organizacion, "speaker")
    miembro_evento = await _al_roster(cliente, cabeceras, evento["id"], ponente)
    asignada = await cliente.put(
        f"{EVENTS}/{evento['id']}/sessions/{sesion['id']}/participants",
        headers=cabeceras,
        json={
            "expected_updated_at": sesion["updated_at"],
            "participants": [{"event_member_id": miembro_evento, "role_key": "speaker"}],
        },
    )
    assert asignada.status_code == 200, asignada.text

    respuesta = await cliente.get(f"{EVENTS}/{evento['id']}/participations", headers=cabeceras)
    _, cabeceras_ajenas = await iniciar_sesion(cliente, otra_organizacion)
    ajena = await cliente.get(f"{EVENTS}/{evento['id']}/participations", headers=cabeceras_ajenas)

    assert respuesta.status_code == 200, respuesta.text
    (participacion,) = respuesta.json()
    assert participacion["event_member_id"] == miembro_evento
    assert participacion["session_id"] == sesion["id"]
    assert participacion["session_title"] == "Charla"
    assert participacion["role_key"] == "speaker"
    assert ajena.status_code == 404
