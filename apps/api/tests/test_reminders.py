"""Recordatorio a los inscritos antes del evento: cuándo sale, a quién no, que
no se duplica y qué dice el correo."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from app.core.database import SessionMaintenance
from app.modules.events.models import Event
from app.modules.registrations.models import EventRegistration
from app.modules.reminders import service as reminders
from tests.conftest import OrganizacionDePrueba


@pytest.fixture
def correo(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """Proveedor de correo simulado y la cola sustituida por el envío directo."""
    proveedor = AsyncMock()
    monkeypatch.setattr(reminders, "get_email_provider", lambda: proveedor)

    async def _enviar(registration_id: str) -> None:
        await reminders.enviar_recordatorio(uuid.UUID(registration_id))

    monkeypatch.setattr(
        "app.core.tasks.send_event_reminder_task.kiq", AsyncMock(side_effect=_enviar)
    )
    return proveedor.send


async def _evento(
    organizacion: OrganizacionDePrueba, *, horas: float, recordatorio: int = 24, **extra: object
) -> uuid.UUID:
    ahora = datetime.now(UTC)
    datos: dict[str, object] = {
        "slug": f"recordatorio-{uuid.uuid4().hex[:8]}",
        "title": "Jornada de IA",
        "status": "published",
        "visibility": "public",
        "starts_at": ahora + timedelta(hours=horas),
        "ends_at": ahora + timedelta(hours=horas + 3),
        "location_mode": "in_person",
        "location_name": "Sala Norte",
        "location_address": "Calle Mayor 1",
        "reminder_hours_before": recordatorio,
        **extra,
    }
    async with SessionMaintenance() as session:
        evento = Event(organization_id=organizacion.id, **datos)
        session.add(evento)
        await session.commit()
        return evento.id


async def _inscripcion(
    organizacion: OrganizacionDePrueba,
    event_id: uuid.UUID,
    *,
    estado: str = "confirmed",
    confirmada_hace: timedelta = timedelta(days=3),
) -> uuid.UUID:
    async with SessionMaintenance() as session:
        inscripcion = EventRegistration(
            event_id=event_id,
            organization_id=organizacion.id,
            email=f"asistente-{uuid.uuid4().hex[:8]}@example.com",
            full_name="Asistente",
            status=estado,
            confirmed_at=datetime.now(UTC) - confirmada_hace if estado == "confirmed" else None,
        )
        session.add(inscripcion)
        await session.commit()
        return inscripcion.id


async def _sql(sentencia: str, **parametros: object) -> None:
    async with SessionMaintenance() as session:
        await session.execute(text(sentencia), parametros)
        await session.commit()


def _cuerpo(correo: AsyncMock) -> str:
    return correo.await_args.kwargs["body"]


async def test_sale_una_sola_vez_cuando_llega_su_momento(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    inscripcion = await _inscripcion(organizacion, evento)

    assert await reminders.procesar_recordatorios() == 1
    assert await reminders.procesar_recordatorios() == 0

    correo.assert_awaited_once()
    argumentos = correo.await_args.kwargs
    assert argumentos["subject"].startswith("Recordatorio: Jornada de IA — ")
    cuerpo = argumentos["body"]
    # El botón del correo es la primera URL: la de la entrada, no la de cancelar.
    assert cuerpo.index("/mi-entrada?token=") < cuerpo.index("/cancelar-inscripcion?token=")
    assert cuerpo.index("http") == cuerpo.index("http", cuerpo.index("aquí:"))
    assert "Sala Norte, Calle Mayor 1" in cuerpo
    assert "Las ausencias sin avisar" in cuerpo
    [qr] = argumentos["attachments"]
    assert qr.cid == "entrada@eventarium"
    async with SessionMaintenance() as session:
        fila = await session.get(EventRegistration, inscripcion)
        assert fila.reminder_sent_at is not None
        assert fila.reminder_claimed_at is None


@pytest.mark.parametrize(
    ("horas", "extra", "estado", "confirmada_hace"),
    [
        (30, {}, "confirmed", timedelta(days=3)),  # aún no le toca
        (0.5, {}, "confirmed", timedelta(days=3)),  # menos de 60 minutos
        (20, {}, "confirmed", timedelta(hours=1)),  # se confirmó dentro de la ventana
        (20, {}, "waitlisted", timedelta(days=3)),
        (20, {"status": "draft"}, "confirmed", timedelta(days=3)),
        (20, {"status": "cancelled"}, "confirmed", timedelta(days=3)),
        (20, {"reminder_enabled": False}, "confirmed", timedelta(days=3)),
    ],
    ids=[
        "antes-de-tiempo",
        "casi-empezado",
        "recien-confirmada",
        "en-espera",
        "borrador",
        "cancelado",
        "desactivado",
    ],
)
async def test_no_sale_cuando_no_corresponde(
    organizacion: OrganizacionDePrueba,
    correo: AsyncMock,
    horas: float,
    extra: dict,
    estado: str,
    confirmada_hace: timedelta,
) -> None:
    evento = await _evento(organizacion, horas=horas, **extra)
    await _inscripcion(organizacion, evento, estado=estado, confirmada_hace=confirmada_hace)

    assert await reminders.procesar_recordatorios() == 0
    correo.assert_not_awaited()


async def test_si_cambia_la_fecha_vuelve_a_salir_pero_no_si_solo_cambian_las_horas(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    await _inscripcion(organizacion, evento)
    assert await reminders.procesar_recordatorios() == 1

    await _sql("UPDATE events SET reminder_hours_before = 48 WHERE id = :id", id=evento)
    assert await reminders.procesar_recordatorios() == 0

    await _sql(
        "UPDATE events SET starts_at = starts_at + interval '2 hours', "
        "ends_at = ends_at + interval '2 hours' WHERE id = :id",
        id=evento,
    )
    assert await reminders.procesar_recordatorios() == 1
    assert correo.await_count == 2


async def test_dos_ejecuciones_a_la_vez_no_reclaman_dos_veces(
    organizacion: OrganizacionDePrueba,
) -> None:
    evento = await _evento(organizacion, horas=20)
    await _inscripcion(organizacion, evento)

    primero, segundo = await asyncio.gather(reminders.reclamar_lote(), reminders.reclamar_lote())

    assert len(primero) + len(segundo) == 1


async def test_una_reclamacion_atascada_se_reintenta_a_los_30_minutos(
    organizacion: OrganizacionDePrueba,
) -> None:
    evento = await _evento(organizacion, horas=20)
    reciente = await _inscripcion(organizacion, evento)
    atascada = await _inscripcion(organizacion, evento)
    await _sql(
        "UPDATE event_registrations SET reminder_claimed_at = now() - interval '10 minutes' "
        "WHERE id = :id",
        id=reciente,
    )
    await _sql(
        "UPDATE event_registrations SET reminder_claimed_at = now() - interval '31 minutes' "
        "WHERE id = :id",
        id=atascada,
    )

    assert await reminders.reclamar_lote() == [atascada]


async def test_un_evento_grande_sale_entero_en_una_ejecucion(
    organizacion: OrganizacionDePrueba, monkeypatch: pytest.MonkeyPatch
) -> None:
    encolar = AsyncMock()
    monkeypatch.setattr("app.core.tasks.send_event_reminder_task.kiq", encolar)
    monkeypatch.setattr(reminders, "TAMANO_DE_LOTE", 3)
    evento = await _evento(organizacion, horas=20)
    for _ in range(7):
        await _inscripcion(organizacion, evento)

    assert await reminders.procesar_recordatorios() == 7
    assert encolar.await_count == 7


async def test_en_linea_el_enlace_para_conectarse_va_al_final_y_el_texto_ajeno_no_enlaza(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(
        organizacion,
        horas=20,
        title="Taller http://pago-falso.example",
        location_mode="online",
        online_url="https://meet.example/sala",
    )
    await _inscripcion(organizacion, evento)

    await reminders.procesar_recordatorios()

    cuerpo = _cuerpo(correo)
    assert "http://pago-falso.example" not in cuerpo
    assert cuerpo.rstrip().endswith("https://meet.example/sala")
    assert cuerpo.index("/mi-entrada?token=") < cuerpo.index("https://meet.example/sala")


async def test_con_lista_de_espera_la_plaza_pasa_a_otra_persona(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    await _inscripcion(organizacion, evento)
    await _inscripcion(organizacion, evento, estado="waitlisted")

    await reminders.procesar_recordatorios()

    assert "para otra persona de la lista de espera" in _cuerpo(correo)


async def test_una_zona_horaria_antigua_invalida_no_impide_el_envio(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    await _inscripcion(organizacion, evento)
    await _sql("UPDATE events SET timezone = 'Madrid' WHERE id = :id", id=evento)

    assert await reminders.procesar_recordatorios() == 1
    correo.assert_awaited_once()


@pytest.mark.parametrize(
    ("horas", "recordatorio", "esperado"),
    [(60, 72, "se te devuelve el importe"), (20, 24, "Ya ha pasado el plazo de reembolso")],
    ids=["en-plazo", "fuera-de-plazo"],
)
async def test_en_eventos_de_pago_dice_si_hay_devolucion(
    organizacion: OrganizacionDePrueba,
    correo: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
    horas: int,
    recordatorio: int,
    esperado: str,
) -> None:
    from app.modules.payments import stripe_client
    from tests.test_payments_refunds import (
        _crear_evento_pagado,
        _crear_organizacion_con_stripe,
        _settings_con_stripe,
    )

    monkeypatch.setattr(stripe_client, "get_settings", _settings_con_stripe)
    cuenta = await _crear_organizacion_con_stripe(organizacion)
    event_id, registration_id, _ = await _crear_evento_pagado(
        organizacion,
        stripe_account_id=cuenta,
        starts_at=datetime.now(UTC) + timedelta(hours=horas),
        payment_intent_id=f"pi_recordatorio_{uuid.uuid4().hex[:6]}",
    )
    await _sql(
        "UPDATE events SET reminder_hours_before = :h WHERE id = :id", h=recordatorio, id=event_id
    )
    await _sql(
        "UPDATE event_registrations SET confirmed_at = now() - interval '5 days' WHERE id = :id",
        id=registration_id,
    )

    assert await reminders.procesar_recordatorios() == 1
    assert esperado in _cuerpo(correo)


async def test_si_se_cancela_tras_reclamarla_no_se_envia(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    inscripcion = await _inscripcion(organizacion, evento)
    [reclamada] = await reminders.reclamar_lote()
    await _sql("UPDATE event_registrations SET status = 'cancelled' WHERE id = :id", id=inscripcion)

    assert await reminders.enviar_recordatorio(reclamada) is False
    correo.assert_not_awaited()


async def test_si_se_aplaza_tras_reclamarla_espera_a_su_momento(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    await _inscripcion(organizacion, evento)
    [reclamada] = await reminders.reclamar_lote()
    await _sql(
        "UPDATE events SET starts_at = starts_at + interval '7 days', "
        "ends_at = ends_at + interval '7 days' WHERE id = :id",
        id=evento,
    )

    assert await reminders.enviar_recordatorio(reclamada) is False
    correo.assert_not_awaited()


async def test_si_falla_el_correo_queda_reclamada_y_sin_marcar_como_enviada(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    inscripcion = await _inscripcion(organizacion, evento)
    correo.side_effect = OSError("SMTP caído")
    [reclamada] = await reminders.reclamar_lote()

    with pytest.raises(OSError):
        await reminders.enviar_recordatorio(reclamada)

    async with SessionMaintenance() as session:
        fila = await session.get(EventRegistration, inscripcion)
        assert fila.reminder_sent_at is None
        assert fila.reminder_claimed_at is not None


async def test_en_un_hibrido_el_boton_sigue_siendo_la_entrada(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(
        organizacion, horas=20, location_mode="hybrid", online_url="https://meet.example/x"
    )
    await _inscripcion(organizacion, evento)

    await reminders.procesar_recordatorios()

    cuerpo = _cuerpo(correo)
    assert "Sala Norte, Calle Mayor 1 (o en línea" in cuerpo
    assert cuerpo.index("/mi-entrada?token=") < cuerpo.index("https://meet.example/x")


async def test_con_la_entrada_revocada_no_promete_un_qr(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    from app.modules.tickets.service import emitir_entrada

    evento = await _evento(organizacion, horas=20)
    inscripcion = await _inscripcion(organizacion, evento)
    async with SessionMaintenance() as session:
        ticket = await emitir_entrada(session, await session.get(EventRegistration, inscripcion))
        ticket.revoked_at = datetime.now(UTC)
        await session.commit()

    await reminders.procesar_recordatorios()

    assert correo.await_args.kwargs["attachments"] == []
    assert "código QR de este correo" not in _cuerpo(correo)


async def test_una_organizacion_desactivada_no_envia(
    organizacion: OrganizacionDePrueba, correo: AsyncMock
) -> None:
    evento = await _evento(organizacion, horas=20)
    await _inscripcion(organizacion, evento)
    await _sql("UPDATE organizations SET is_active = false WHERE id = :id", id=organizacion.id)

    assert await reminders.procesar_recordatorios() == 0
