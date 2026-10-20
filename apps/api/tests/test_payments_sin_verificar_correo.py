"""En un evento de pago no se pide verificar el correo: el formulario lleva
directo a la pasarela, aunque el evento tenga la verificación activada."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from tests.conftest import OrganizacionDePrueba
from tests.payments_test_helpers import (
    FakeStripeClient,
    _estado_inscripcion,
    _preparar_evento_de_pago,
    _sesion_creada,
    _url_checkout,
)


def _compra(tipo: dict, email: str) -> dict:
    return {
        "email": email,
        "full_name": "Compradora Directa",
        "data_processing_accepted": True,
        "ticket_type_id": tipo["id"],
        "turnstile_token": "token-de-prueba",
    }


async def test_con_verificacion_activada_va_directo_a_pagar(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    monkeypatch: pytest.MonkeyPatch,
    fake: FakeStripeClient,
) -> None:
    evento, tipo = await _preparar_evento_de_pago(
        cliente, organizacion, monkeypatch, "pago-directo", email_verification_required=True
    )
    fake.v1.checkout.sessions.create_async.return_value = _sesion_creada()

    respuesta = await cliente.post(
        _url_checkout(evento["slug"]), json=_compra(tipo, "directa@example.com")
    )

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["checkout_url"]
    assert await _estado_inscripcion(evento["id"], "directa@example.com") == "pending_payment"


async def test_una_inscripcion_que_esperaba_verificacion_pasa_a_pagar(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    monkeypatch: pytest.MonkeyPatch,
    fake: FakeStripeClient,
) -> None:
    evento, tipo = await _preparar_evento_de_pago(
        cliente, organizacion, monkeypatch, "pago-pendiente", email_verification_required=True
    )
    fake.v1.checkout.sessions.create_async.return_value = _sesion_creada()
    primera = await cliente.post(
        _url_checkout(evento["slug"]), json=_compra(tipo, "esperaba@example.com")
    )
    assert primera.status_code == 200, primera.text
    # Como quedaban antes de este cambio: esperando el enlace del correo.
    async with SessionMaintenance() as session:
        await session.execute(
            text(
                "UPDATE event_registrations SET status = 'pending_verification' "
                "WHERE email = 'esperaba@example.com'"
            )
        )
        await session.commit()

    fake.v1.checkout.sessions.create_async.return_value = _sesion_creada("cs_test_2")
    segunda = await cliente.post(
        _url_checkout(evento["slug"]), json=_compra(tipo, "esperaba@example.com")
    )

    assert segunda.status_code == 200, segunda.text
    assert segunda.json()["checkout_url"]
    assert await _estado_inscripcion(evento["id"], "esperaba@example.com") == "pending_payment"
