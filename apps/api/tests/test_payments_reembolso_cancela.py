"""Un reembolso total cancela la inscripción y libera su plaza, venga del
panel o del Dashboard de Stripe del organizador; uno parcial no la toca."""

from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import SessionMaintenance
from app.modules.events.models import Event
from app.modules.payments import stripe_client
from app.modules.payments import webhooks as payments_webhooks
from app.modules.registrations import service as registrations_service
from app.modules.registrations.models import EventRegistration
from app.modules.tickets.models import EventTicket
from tests.conftest import OrganizacionDePrueba
from tests.test_payments_refunds import (
    WEBHOOK_URL,
    _crear_evento_pagado,
    _crear_organizacion_con_stripe,
    _cuerpo_charge_refunded,
    _firmar,
    _settings_con_stripe,
)


async def _avisar_reembolso(
    cliente: AsyncClient, *, payment_intent: str, amount_refunded: int, account: str
) -> None:
    cuerpo = _cuerpo_charge_refunded(
        event_id=f"evt_{uuid.uuid4().hex}",
        payment_intent=payment_intent,
        amount_refunded=amount_refunded,
        account=account,
    )
    respuesta = await cliente.post(
        WEBHOOK_URL, content=cuerpo, headers={"stripe-signature": _firmar(cuerpo, int(time.time()))}
    )
    assert respuesta.status_code == 200, respuesta.text


@pytest.fixture
def correo_cancelacion(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    monkeypatch.setattr(stripe_client, "get_settings", _settings_con_stripe)
    monkeypatch.setattr(
        "app.core.tasks.process_stripe_webhook_task.kiq",
        AsyncMock(side_effect=payments_webhooks.procesar_evento),
    )
    envio = AsyncMock()
    monkeypatch.setattr(registrations_service.send_registration_cancelled_email, "kiq", envio)
    return envio


async def test_reembolso_total_cancela_la_inscripcion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correo_cancelacion: AsyncMock
) -> None:
    cuenta = await _crear_organizacion_con_stripe(organizacion)
    _, registration_id, _ = await _crear_evento_pagado(
        organizacion, stripe_account_id=cuenta, payment_intent_id="pi_cancela_1"
    )

    await _avisar_reembolso(
        cliente, payment_intent="pi_cancela_1", amount_refunded=1000, account=cuenta
    )

    async with SessionMaintenance() as session:
        inscripcion = await session.get(EventRegistration, registration_id)
        assert inscripcion.status == "cancelled"
        assert inscripcion.cancelled_at is not None
        ticket = await session.scalar(
            select(EventTicket).where(EventTicket.registration_id == registration_id)
        )
        assert ticket.revoked_at is not None
    correo_cancelacion.assert_awaited_once()
    # El correo dice que el dinero ya se ha devuelto, no que se está tramitando.
    assert correo_cancelacion.await_args.args[2] == "reembolsado"


async def test_reembolso_parcial_no_cancela_hasta_completar_el_total(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correo_cancelacion: AsyncMock
) -> None:
    cuenta = await _crear_organizacion_con_stripe(organizacion)
    _, registration_id, _ = await _crear_evento_pagado(
        organizacion, stripe_account_id=cuenta, payment_intent_id="pi_parcial_cancela"
    )

    await _avisar_reembolso(
        cliente, payment_intent="pi_parcial_cancela", amount_refunded=400, account=cuenta
    )
    async with SessionMaintenance() as session:
        assert (await session.get(EventRegistration, registration_id)).status == "confirmed"
    correo_cancelacion.assert_not_awaited()

    await _avisar_reembolso(
        cliente, payment_intent="pi_parcial_cancela", amount_refunded=1000, account=cuenta
    )
    async with SessionMaintenance() as session:
        assert (await session.get(EventRegistration, registration_id)).status == "cancelled"
    correo_cancelacion.assert_awaited_once()


async def test_reembolso_de_una_inscripcion_ya_cancelada_no_repite_la_cancelacion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correo_cancelacion: AsyncMock
) -> None:
    """El reembolso automático de una cancelación llega después de cancelar:
    no debe mandar un segundo correo ni tocar la fecha de cancelación."""
    cuenta = await _crear_organizacion_con_stripe(organizacion)
    _, registration_id, _ = await _crear_evento_pagado(
        organizacion, stripe_account_id=cuenta, payment_intent_id="pi_ya_cancelada"
    )
    async with SessionMaintenance() as session:
        inscripcion = await session.get(EventRegistration, registration_id)
        inscripcion.status = "cancelled"
        await session.commit()

    await _avisar_reembolso(
        cliente, payment_intent="pi_ya_cancelada", amount_refunded=1000, account=cuenta
    )

    async with SessionMaintenance() as session:
        inscripcion = await session.get(EventRegistration, registration_id)
        assert inscripcion.status == "cancelled"
        assert inscripcion.cancelled_at is None
    correo_cancelacion.assert_not_awaited()


async def test_reembolso_total_libera_la_plaza_para_la_lista_de_espera(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correo_cancelacion: AsyncMock
) -> None:
    cuenta = await _crear_organizacion_con_stripe(organizacion)
    event_id, _, _ = await _crear_evento_pagado(
        organizacion, stripe_account_id=cuenta, payment_intent_id="pi_libera", capacity=1
    )
    async with SessionMaintenance() as session:
        en_espera = EventRegistration(
            event_id=event_id,
            organization_id=organizacion.id,
            email=f"espera-{uuid.uuid4().hex[:6]}@example.com",
            full_name="En lista de espera",
            status="waitlisted",
        )
        session.add(en_espera)
        await session.commit()
        en_espera_id = en_espera.id

    await _avisar_reembolso(
        cliente, payment_intent="pi_libera", amount_refunded=1000, account=cuenta
    )

    async with SessionMaintenance() as session:
        promovida = await session.get(EventRegistration, en_espera_id)
        assert promovida.waitlist_promoted_at is not None


async def test_en_un_evento_cancelado_lo_deja_al_barrido_de_la_cancelacion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correo_cancelacion: AsyncMock
) -> None:
    """El barrido de la cancelación del evento marca la inscripción como
    cancelada con el evento y envía su propio aviso: el webhook no se adelanta
    con el correo genérico, aunque la entrada sí queda revocada."""
    cuenta = await _crear_organizacion_con_stripe(organizacion)
    event_id, registration_id, _ = await _crear_evento_pagado(
        organizacion, stripe_account_id=cuenta, payment_intent_id="pi_evento_cancelado"
    )
    async with SessionMaintenance() as session:
        (await session.get(Event, event_id)).status = "cancelled"
        await session.commit()

    await _avisar_reembolso(
        cliente, payment_intent="pi_evento_cancelado", amount_refunded=1000, account=cuenta
    )

    async with SessionMaintenance() as session:
        assert (await session.get(EventRegistration, registration_id)).status == "confirmed"
        ticket = await session.scalar(
            select(EventTicket).where(EventTicket.registration_id == registration_id)
        )
        assert ticket.revoked_at is not None
    correo_cancelacion.assert_not_awaited()
