"""El enlace de cancelar ya no cancela al abrirse: la vista previa enseña qué se
cancela sin gastar el enlace, y una vez empezado el evento ni se cancela desde
el enlace ni se ofrece la plaza a la lista de espera."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core.database import SessionMaintenance
from app.modules.auth.verification import PROPOSITO_CANCELACION_INSCRIPCION, generate_token
from app.modules.registrations import service as registrations_service
from app.modules.registrations.models import EventRegistration
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_registrations_emails_and_cancellation import (
    CANCEL,
    _crear_inscripcion,
    _crear_y_publicar_evento,
    _estado,
    _tareas_de_email_mockeadas,  # noqa: F401  (fixture autouse con los correos simulados)
)

PREVIEW = f"{CANCEL}/preview"


@pytest.fixture
def correos(_tareas_de_email_mockeadas):  # noqa: F811  (la fixture autouse del otro módulo)
    return _tareas_de_email_mockeadas


def _inicio(horas: float) -> dict[str, str]:
    ahora = datetime.now(UTC).replace(microsecond=0)
    return {
        "starts_at": (ahora + timedelta(hours=horas)).isoformat(),
        "ends_at": (ahora + timedelta(days=2)).isoformat(),
    }


async def test_la_vista_previa_no_gasta_el_enlace(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(cliente, cabeceras, "vista-previa", **_inicio(5))
    registration_id = await _crear_inscripcion(organizacion, evento, email="a@example.com")
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, registration_id)

    for _ in range(2):
        vista = await cliente.post(PREVIEW, json={"token": token})
        assert vista.status_code == 200, vista.text
    datos = vista.json()
    assert datos["event_title"] == evento["title"]
    assert datos["status"] == "confirmed"
    assert datos["already_started"] is False
    assert datos["refund"] is None
    assert await _estado(registration_id) == "confirmed"

    cancelada = await cliente.post(CANCEL, json={"token": token})
    assert cancelada.status_code == 200, cancelada.text
    assert await _estado(registration_id) == "cancelled"


async def test_la_vista_previa_con_un_enlace_inventado_da_el_error_generico(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    respuesta = await cliente.post(PREVIEW, json={"token": "inventado"})
    assert respuesta.status_code == 422


async def test_con_el_evento_empezado_no_cancela_ni_gasta_el_enlace(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(cliente, cabeceras, "ya-empezado", **_inicio(-1))
    registration_id = await _crear_inscripcion(organizacion, evento, email="b@example.com")
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, registration_id)

    respuesta = await cliente.post(CANCEL, json={"token": token})

    assert respuesta.status_code == 409, respuesta.text
    assert await _estado(registration_id) == "confirmed"
    assert correos["cancelada"].await_count == 0
    # El enlace sigue sirviendo para ver la entrada (no se ha consumido).
    vista = await cliente.post(PREVIEW, json={"token": token})
    assert vista.status_code == 200
    assert vista.json()["already_started"] is True


async def test_con_el_evento_empezado_no_se_promueve_la_lista_de_espera(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(
        cliente, cabeceras, "sin-promocion", capacity=1, **_inicio(-1)
    )
    confirmada = await _crear_inscripcion(organizacion, evento, email="c@example.com")
    en_espera = await _crear_inscripcion(
        organizacion, evento, email="d@example.com", status="waitlisted"
    )

    # El organizador sí puede cancelar desde el panel, pero la plaza no se ofrece.
    async with SessionMaintenance() as session:
        await registrations_service.cancel_registration(
            session,
            organization_id=organizacion.id,
            event_id=uuid.UUID(evento["id"]),
            registration_id=uuid.UUID(confirmada),
        )
        await session.commit()

    assert await _estado(confirmada) == "cancelled"
    async with SessionMaintenance() as session:
        espera = await session.get(EventRegistration, uuid.UUID(en_espera))
        assert espera.waitlist_promoted_at is None
    assert correos["promocion"].await_count == 0


async def test_la_ventana_de_promocion_no_pasa_del_inicio_del_evento(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(
        cliente, cabeceras, "ventana-corta", capacity=1, **_inicio(2)
    )
    confirmada = await _crear_inscripcion(organizacion, evento, email="e@example.com")
    en_espera = await _crear_inscripcion(
        organizacion, evento, email="f@example.com", status="waitlisted"
    )
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, confirmada)

    respuesta = await cliente.post(CANCEL, json={"token": token})

    assert respuesta.status_code == 200, respuesta.text
    async with SessionMaintenance() as session:
        espera = await session.get(EventRegistration, uuid.UUID(en_espera))
        assert espera.waitlist_promotion_expires_at is not None
        assert espera.waitlist_promotion_expires_at <= datetime.fromisoformat(evento["starts_at"])


@pytest.mark.parametrize(
    ("dias", "esperado"), [(10, "en_curso"), (0.5, "sin_reembolso")], ids=["en-plazo", "fuera"]
)
async def test_la_vista_previa_dice_si_se_devolveria_el_pago(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    monkeypatch: pytest.MonkeyPatch,
    dias: float,
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
    _, registration_id, _ = await _crear_evento_pagado(
        organizacion,
        stripe_account_id=cuenta,
        starts_at=datetime.now(UTC) + timedelta(days=dias),
        payment_intent_id=f"pi_vista_{uuid.uuid4().hex[:6]}",
    )
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, str(registration_id))

    vista = await cliente.post(PREVIEW, json={"token": token})

    assert vista.status_code == 200, vista.text
    assert vista.json()["refund"] == esperado


async def test_la_vista_previa_de_una_ya_cancelada_no_ofrece_reembolso(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(cliente, cabeceras, "ya-cancelada", **_inicio(5))
    registration_id = await _crear_inscripcion(
        organizacion, evento, email="g@example.com", status="cancelled"
    )
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, registration_id)

    vista = await cliente.post(PREVIEW, json={"token": token})

    assert vista.status_code == 200
    assert vista.json()["status"] == "cancelled"
    assert vista.json()["refund"] is None


async def test_un_token_de_otro_proposito_no_vale_para_la_vista_previa(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    from app.modules.auth.verification import PROPOSITO_PROMOCION_LISTA_ESPERA

    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(cliente, cabeceras, "otro-proposito", **_inicio(5))
    registration_id = await _crear_inscripcion(organizacion, evento, email="h@example.com")
    token = await generate_token(PROPOSITO_PROMOCION_LISTA_ESPERA, registration_id)

    assert (await cliente.post(PREVIEW, json={"token": token})).status_code == 422


async def test_sin_unos_minutos_de_margen_no_se_ofrece_la_plaza(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(
        cliente, cabeceras, "sin-margen", capacity=1, **_inicio(0.1)
    )
    confirmada = await _crear_inscripcion(organizacion, evento, email="i@example.com")
    en_espera = await _crear_inscripcion(
        organizacion, evento, email="j@example.com", status="waitlisted"
    )
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, confirmada)

    assert (await cliente.post(CANCEL, json={"token": token})).status_code == 200
    async with SessionMaintenance() as session:
        assert (
            await session.get(EventRegistration, uuid.UUID(en_espera))
        ).waitlist_promoted_at is None
    assert correos["promocion"].await_count == 0


async def test_el_correo_de_promocion_da_la_hora_limite_en_la_zona_del_evento(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
) -> None:
    from app.core.fechas import fecha_y_hora

    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_y_publicar_evento(
        cliente, cabeceras, "hora-local", capacity=1, timezone="America/Mexico_City", **_inicio(2)
    )
    confirmada = await _crear_inscripcion(organizacion, evento, email="k@example.com")
    await _crear_inscripcion(organizacion, evento, email="l@example.com", status="waitlisted")
    token = await generate_token(PROPOSITO_CANCELACION_INSCRIPCION, confirmada)

    assert (await cliente.post(CANCEL, json={"token": token})).status_code == 200
    expira_el = correos["promocion"].await_args.args[4]
    inicio = datetime.fromisoformat(evento["starts_at"])
    assert expira_el == fecha_y_hora(inicio, "America/Mexico_City")
