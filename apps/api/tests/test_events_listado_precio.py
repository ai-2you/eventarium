"""El listado de eventos del panel lleva el modo de inscripción, el aforo y el
precio de la entrada más barata, para verlos sin abrir cada evento."""

from __future__ import annotations

import uuid
from datetime import timedelta

from httpx import AsyncClient

from app.core.database import SessionMaintenance
from app.modules.payments.models import EventTicketType
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_events_public import AHORA, EVENTS, _payload_evento


async def _entradas(organizacion: OrganizacionDePrueba, event_id: str, *tipos: tuple) -> None:
    async with SessionMaintenance() as session:
        for nombre, precio, activo, desde in tipos:
            session.add(
                EventTicketType(
                    organization_id=organizacion.id,
                    event_id=uuid.UUID(event_id),
                    name=nombre,
                    price_cents=precio,
                    is_active=activo,
                    sales_start_at=desde,
                )
            )
        await session.commit()


async def test_el_listado_trae_modo_aforo_y_precio(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    libre = (
        await cliente.post(EVENTS, headers=cabeceras, json=_payload_evento("libre", capacity=50))
    ).json()
    de_pago = (
        await cliente.post(
            EVENTS,
            headers=cabeceras,
            json=_payload_evento("de-pago", registration_mode="paid", capacity=120),
        )
    ).json()
    sin_entradas = (
        await cliente.post(
            EVENTS,
            headers=cabeceras,
            json=_payload_evento("sin-entradas", registration_mode="paid"),
        )
    ).json()
    await _entradas(
        organizacion,
        de_pago["id"],
        ("General", 1500, True, None),
        # La venta aún no ha abierto, pero el organizador quiere ver su precio.
        ("Anticipada", 900, True, AHORA + timedelta(days=1)),
        # Un tipo desactivado no cuenta.
        ("Antigua", 100, False, None),
    )

    respuesta = await cliente.get(EVENTS, headers=cabeceras)

    assert respuesta.status_code == 200, respuesta.text
    por_id = {evento["id"]: evento for evento in respuesta.json()["items"]}
    assert por_id[libre["id"]]["registration_mode"] == "free"
    assert por_id[libre["id"]]["capacity"] == 50
    assert por_id[libre["id"]]["price_from_cents"] is None
    pago = por_id[de_pago["id"]]
    assert (pago["capacity"], pago["price_from_cents"], pago["price_currency"]) == (120, 900, "eur")
    assert pago["price_multiple"] is True
    assert por_id[sin_entradas["id"]]["price_from_cents"] is None
    assert por_id[sin_entradas["id"]]["price_multiple"] is False
