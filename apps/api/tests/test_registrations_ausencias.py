"""Cierre de asistencia e historial de ausencias: qué cuenta como ausencia,
que no cruza organizaciones y quién puede cerrar o reabrir la asistencia."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from app.modules.events.models import Event
from app.modules.registrations.models import EventRegistration
from app.modules.tickets.service import emitir_entrada
from tests.conftest import (
    OrganizacionDePrueba,
    crear_miembro,
    iniciar_sesion,
    iniciar_sesion_con,
)

EVENTS = "/api/v1/events"
CORREO = "ausente@example.com"


async def _evento(organizacion: OrganizacionDePrueba, *, dias: float, **extra: object) -> uuid.UUID:
    """Evento presencial que terminó (dias < 0) o terminará (dias > 0)."""
    fin = datetime.now(UTC) + timedelta(days=dias)
    datos: dict[str, object] = {
        "slug": f"ausencias-{uuid.uuid4().hex[:8]}",
        "title": "Evento pasado",
        "status": "published",
        "visibility": "public",
        "starts_at": fin - timedelta(hours=3),
        "ends_at": fin,
        "location_mode": "in_person",
        **extra,
    }
    async with SessionMaintenance() as session:
        evento = Event(organization_id=organizacion.id, **datos)
        session.add(evento)
        await session.commit()
        return evento.id


async def _ausencia(
    organizacion: OrganizacionDePrueba, *, correo: str = CORREO, **evento: object
) -> uuid.UUID:
    """Una ausencia completa: confirmada, avisada, verificada, sin escanear y con
    la asistencia del evento cerrada. Devuelve el id de la inscripción."""
    event_id = await _evento(
        organizacion, dias=-2, attendance_closed_at=datetime.now(UTC), **evento
    )
    async with SessionMaintenance() as session:
        inicio = (await session.get(Event, event_id)).starts_at
        inscripcion = EventRegistration(
            event_id=event_id,
            organization_id=organizacion.id,
            email=correo,
            full_name="Persona ausente",
            status="confirmed",
            confirmed_at=inicio - timedelta(days=5),
            verified_at=inicio - timedelta(days=5),
            reminder_sent_at=inicio - timedelta(days=1),
        )
        session.add(inscripcion)
        await session.flush()
        await emitir_entrada(session, inscripcion)
        await session.commit()
        return inscripcion.id


async def _inscrita_en_evento_futuro(
    organizacion: OrganizacionDePrueba, correo: str = CORREO
) -> tuple[uuid.UUID, uuid.UUID]:
    event_id = await _evento(organizacion, dias=10)
    async with SessionMaintenance() as session:
        inscripcion = EventRegistration(
            event_id=event_id,
            organization_id=organizacion.id,
            email=correo,
            full_name="Persona ausente",
            status="pending_approval",
        )
        session.add(inscripcion)
        await session.commit()
        return event_id, inscripcion.id


async def _ausencias_en_el_panel(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> tuple[int, list[dict]]:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    event_id, registration_id = await _inscrita_en_evento_futuro(organizacion)
    listado = await cliente.get(f"{EVENTS}/{event_id}/registrations", headers=cabeceras)
    detalle = await cliente.get(
        f"{EVENTS}/{event_id}/registrations/{registration_id}", headers=cabeceras
    )
    assert listado.status_code == 200, listado.text
    assert detalle.status_code == 200, detalle.text
    [fila] = listado.json()["items"]
    assert detalle.json()["absences_count"] == fila["absences_count"]
    return fila["absences_count"], detalle.json()["absences"]


async def test_una_ausencia_se_ve_en_el_listado_y_en_el_detalle(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    await _ausencia(organizacion)

    total, detalle = await _ausencias_en_el_panel(cliente, organizacion)

    assert total == 1
    assert [ausencia["event_title"] for ausencia in detalle] == ["Evento pasado"]


_CAMBIOS = {
    "asistencia-sin-cerrar": "UPDATE events SET attendance_closed_at = NULL WHERE id = :e",
    "hibrido": "UPDATE events SET location_mode = 'hybrid' WHERE id = :e",
    "evento-cancelado": "UPDATE events SET status = 'cancelled' WHERE id = :e",
    "hace-mas-de-un-ano": (
        "UPDATE events SET starts_at = now() - interval '13 months', "
        "ends_at = now() - interval '13 months' + interval '3 hours' WHERE id = :e"
    ),
    "entrada-escaneada": "UPDATE event_tickets SET used_at = now() WHERE registration_id = :r",
    "entrada-revocada": "UPDATE event_tickets SET revoked_at = now() WHERE registration_id = :r",
    "sin-recordatorio": "UPDATE event_registrations SET reminder_sent_at = NULL WHERE id = :r",
    "correo-sin-verificar": "UPDATE event_registrations SET verified_at = NULL WHERE id = :r",
    "cancelada": "UPDATE event_registrations SET status = 'cancelled' WHERE id = :r",
    "confirmada-tras-empezar": (
        "UPDATE event_registrations r SET confirmed_at = e.starts_at + interval '1 hour' "
        "FROM events e WHERE e.id = r.event_id AND r.id = :r"
    ),
}


@pytest.mark.parametrize("cambio", list(_CAMBIOS), ids=list(_CAMBIOS))
async def test_no_cuenta_si_falta_alguna_condicion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, cambio: str
) -> None:
    registration_id = await _ausencia(organizacion)
    async with SessionMaintenance() as session:
        event_id = (await session.get(EventRegistration, registration_id)).event_id
        await session.execute(text(_CAMBIOS[cambio]), {"e": event_id, "r": registration_id})
        await session.commit()

    total, detalle = await _ausencias_en_el_panel(cliente, organizacion)

    assert (total, detalle) == (0, [])


async def test_no_se_mezclan_organizaciones_con_el_mismo_correo(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    otra_organizacion: OrganizacionDePrueba,
) -> None:
    await _ausencia(otra_organizacion)

    total, _ = await _ausencias_en_el_panel(cliente, organizacion)

    assert total == 0


async def test_cerrar_y_reabrir_la_asistencia(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    futuro = await _evento(organizacion, dias=1)
    pasado = await _evento(organizacion, dias=-1)

    antes = await cliente.post(f"{EVENTS}/{futuro}/attendance/close", headers=cabeceras)
    assert antes.status_code == 409

    cerrada = await cliente.post(f"{EVENTS}/{pasado}/attendance/close", headers=cabeceras)
    assert cerrada.status_code == 200, cerrada.text
    assert cerrada.json()["attendance_closed_at"] is not None

    reabierta = await cliente.post(f"{EVENTS}/{pasado}/attendance/reopen", headers=cabeceras)
    assert reabierta.status_code == 200
    assert reabierta.json()["attendance_closed_at"] is None


async def test_no_se_reabre_pasados_7_dias(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    pasado = await _evento(
        organizacion, dias=-10, attendance_closed_at=datetime.now(UTC) - timedelta(days=8)
    )

    respuesta = await cliente.post(f"{EVENTS}/{pasado}/attendance/reopen", headers=cabeceras)

    assert respuesta.status_code == 409


async def test_cerrar_la_asistencia_exige_permiso_de_entradas(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    pasado = await _evento(organizacion, dias=-1)
    ponente = await crear_miembro(organizacion, "speaker")
    _, cabeceras = await iniciar_sesion_con(cliente, organizacion, ponente.email, ponente.password)

    respuesta = await cliente.post(f"{EVENTS}/{pasado}/attendance/close", headers=cabeceras)

    assert respuesta.status_code == 403


async def test_el_historial_no_sale_por_la_api_publica(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    from app.modules.auth.verification import PROPOSITO_CANCELACION_INSCRIPCION, generate_token

    await _ausencia(organizacion)
    _, registration_id = await _inscrita_en_evento_futuro(organizacion)
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, str(registration_id))

    mi_entrada = await cliente.get(
        "/api/v1/public/registrations/my-ticket", params={"token": token}
    )
    vista = await cliente.post("/api/v1/public/registrations/cancel/preview", json={"token": token})

    for respuesta in (mi_entrada, vista):
        assert "absence" not in respuesta.text


async def test_si_falla_el_historial_el_listado_sigue_sin_la_etiqueta(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.registrations import absences

    await _ausencia(organizacion)
    monkeypatch.setattr(absences, "_POR_CORREO", text("SELECT columna_que_no_existe"))
    monkeypatch.setattr(absences, "_DE_UNA_PERSONA", text("SELECT columna_que_no_existe"))

    total, detalle = await _ausencias_en_el_panel(cliente, organizacion)

    assert (total, detalle) == (0, [])
