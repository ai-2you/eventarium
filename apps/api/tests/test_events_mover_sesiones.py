"""Cambiar las fechas de un evento con agenda: si alguna sesión quedaría fuera,
la API pregunta (409 con código propio) y, si se pide, las mueve con él."""

from __future__ import annotations

from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_events_public import AHORA, EVENTS, _crear_evento
from tests.test_events_sesiones_rango import _sesion


def _fechas(desplazamiento: timedelta, duracion: timedelta = timedelta(days=2)) -> dict:
    return {
        "starts_at": (AHORA + desplazamiento).isoformat(),
        "ends_at": (AHORA + desplazamiento + duracion).isoformat(),
    }


async def test_aplazar_pregunta_y_luego_mueve_la_agenda_entera(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="se-aplaza")
    sesion = await _sesion(cliente, cabeceras, evento["id"])
    una_semana = timedelta(days=7)
    url = f"{EVENTS}/{evento['id']}"

    sin_mover = await cliente.patch(url, headers=cabeceras, json=_fechas(una_semana))
    sigue_igual = (await cliente.get(url, headers=cabeceras)).json()
    moviendo = await cliente.patch(
        url, headers=cabeceras, json={**_fechas(una_semana), "mover_sesiones": True}
    )
    sesiones = (await cliente.get(f"{url}/sessions", headers=cabeceras)).json()

    assert sin_mover.status_code == 409
    cuerpo = sin_mover.json()
    assert cuerpo["code"] == "sesiones_fuera_de_rango"
    assert (cuerpo["sesiones_fuera"], cuerpo["titulos"], cuerpo["movidas"]) == (
        1,
        ["Charla"],
        False,
    )
    assert sigue_igual["starts_at"] == evento["starts_at"]
    assert moviendo.status_code == 200, moviendo.text
    movida = datetime.fromisoformat(sesiones[0]["starts_at"])
    assert movida == datetime.fromisoformat(sesion["starts_at"]) + una_semana


async def test_si_el_evento_se_acorta_ni_moviendo_cabe(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="se-acorta")
    await _sesion(cliente, cabeceras, evento["id"])

    respuesta = await cliente.patch(
        f"{EVENTS}/{evento['id']}",
        headers=cabeceras,
        json={**_fechas(timedelta(hours=3), timedelta(hours=1)), "mover_sesiones": True},
    )

    assert respuesta.status_code == 409
    assert respuesta.json()["movidas"] is True


async def test_ampliar_el_evento_no_pregunta_nada(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="se-amplia")
    await _sesion(cliente, cabeceras, evento["id"])

    respuesta = await cliente.patch(
        f"{EVENTS}/{evento['id']}",
        headers=cabeceras,
        json=_fechas(timedelta(0), timedelta(days=5)),
    )

    assert respuesta.status_code == 200, respuesta.text


async def test_una_sesion_que_ya_estaba_fuera_no_bloquea_cambiar_las_fechas(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-sesion-heredada")
    sesion = await _sesion(cliente, cabeceras, evento["id"])
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE event_sessions SET starts_at = :i, ends_at = :f WHERE id = :id"),
            {
                "i": AHORA - timedelta(days=9),
                "f": AHORA - timedelta(days=9) + timedelta(hours=1),
                "id": sesion["id"],
            },
        )
        await session.commit()

    respuesta = await cliente.patch(
        f"{EVENTS}/{evento['id']}",
        headers=cabeceras,
        json=_fechas(timedelta(0), timedelta(days=5)),
    )

    assert respuesta.status_code == 200, respuesta.text
