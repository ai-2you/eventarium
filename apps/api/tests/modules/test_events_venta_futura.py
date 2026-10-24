"""Evento de pago con la venta programada para más tarde: se puede publicar y la
ficha pública dice cuándo abre; y un evento que ya vendía se sigue pudiendo
editar aunque su venta haya terminado.

Fechas siempre relativas a ahora y con márgenes de horas o días: el resultado
no depende del minuto en que se ejecute.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update

from app.core.database import SessionMaintenance
from app.modules.payments.models import EventTicketType
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.modules.test_events_venta_posible import (  # noqa: F401 (fixture autouse)
    EVENTS,
    _conectar_cuenta_operativa,
    _pagos_habilitados,
    _payload_evento,
)

AHORA = datetime.now(UTC).replace(microsecond=0)
FUTURO = AHORA + timedelta(days=30)


def _ficha(organizacion: OrganizacionDePrueba, slug: str) -> str:
    return f"/api/v1/public/organizations/{organizacion.slug}/events/{slug}"


async def _evento_de_pago(
    cliente: AsyncClient, cabeceras: dict[str, str], slug: str, **tipo: object
) -> str:
    creado = await cliente.post(
        EVENTS,
        headers=cabeceras,
        json=_payload_evento(
            slug,
            registration_mode="paid",
            starts_at=FUTURO.isoformat(),
            ends_at=(FUTURO + timedelta(hours=4)).isoformat(),
        ),
    )
    assert creado.status_code == 201, creado.text
    evento_id = str(creado.json()["id"])
    alta = await cliente.post(
        f"{EVENTS}/{evento_id}/ticket-types",
        headers=cabeceras,
        json={"name": "General", "price_cents": 1000, **tipo},
    )
    assert alta.status_code == 201, alta.text
    return evento_id


async def _publicar(cliente: AsyncClient, cabeceras: dict[str, str], evento_id: str):
    return await cliente.patch(
        f"{EVENTS}/{evento_id}",
        headers=cabeceras,
        json={"status": "published", "visibility": "public"},
    )


async def test_publicar_con_la_venta_programada_para_mas_tarde(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    await _conectar_cuenta_operativa(organizacion)
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    abre = AHORA + timedelta(days=1)
    evento_id = await _evento_de_pago(
        cliente, cabeceras, "venta-mas-tarde", sales_start_at=abre.isoformat()
    )

    publicado = await _publicar(cliente, cabeceras, evento_id)
    assert publicado.status_code == 200, publicado.text

    ficha = await cliente.get(_ficha(organizacion, "venta-mas-tarde"))
    assert ficha.status_code == 200, ficha.text
    cuerpo = ficha.json()
    assert cuerpo["ticket_sales"] == "upcoming"
    assert datetime.fromisoformat(cuerpo["ticket_sales_opens_at"]) == abre
    assert cuerpo["price_from_cents"] is None


async def test_publicar_con_la_venta_terminada_da_409(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    await _conectar_cuenta_operativa(organizacion)
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento_id = await _evento_de_pago(
        cliente,
        cabeceras,
        "venta-terminada",
        sales_start_at=(AHORA - timedelta(days=3)).isoformat(),
        sales_end_at=(AHORA - timedelta(days=1)).isoformat(),
    )

    respuesta = await _publicar(cliente, cabeceras, evento_id)
    assert respuesta.status_code == 409, respuesta.text


async def test_editar_un_evento_publicado_con_la_venta_terminada(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    """La guarda es para entrar en venta, no para cada edición: corregir una
    errata de un evento cuya venta ya cerró no debe dar 409."""
    await _conectar_cuenta_operativa(organizacion)
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento_id = await _evento_de_pago(cliente, cabeceras, "editar-tras-la-venta")
    assert (await _publicar(cliente, cabeceras, evento_id)).status_code == 200
    async with SessionMaintenance() as session:
        await session.execute(
            update(EventTicketType)
            .where(EventTicketType.event_id == evento_id)
            .values(sales_end_at=AHORA - timedelta(hours=1))
        )
        await session.commit()

    editado = await cliente.patch(
        f"{EVENTS}/{evento_id}", headers=cabeceras, json={"title": "Título corregido"}
    )
    assert editado.status_code == 200, editado.text

    ficha = await cliente.get(_ficha(organizacion, "editar-tras-la-venta"))
    assert ficha.json()["ticket_sales"] == "closed"
    assert ficha.json()["ticket_sales_opens_at"] is None


async def test_venta_abierta_y_evento_gratuito(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    await _conectar_cuenta_operativa(organizacion)
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento_id = await _evento_de_pago(cliente, cabeceras, "venta-abierta")
    assert (await _publicar(cliente, cabeceras, evento_id)).status_code == 200
    gratis = await cliente.post(
        EVENTS,
        headers=cabeceras,
        json=_payload_evento("evento-gratis-venta", status="published", visibility="public"),
    )
    assert gratis.status_code == 201, gratis.text

    abierta = (await cliente.get(_ficha(organizacion, "venta-abierta"))).json()
    assert abierta["ticket_sales"] == "open"
    assert abierta["ticket_sales_opens_at"] is None
    assert abierta["price_from_cents"] == 1000
    gratuita = (await cliente.get(_ficha(organizacion, "evento-gratis-venta"))).json()
    assert gratuita["ticket_sales"] is None


async def test_la_apertura_anunciada_es_la_mas_tardia_con_la_inscripcion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    """Si la inscripción del evento abre después que la venta del tipo, antes
    de esa hora no se puede comprar: se anuncia la más tardía."""
    await _conectar_cuenta_operativa(organizacion)
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    venta = AHORA + timedelta(days=1)
    inscripcion = AHORA + timedelta(days=2)
    evento_id = await _evento_de_pago(
        cliente, cabeceras, "apertura-mas-tardia", sales_start_at=venta.isoformat()
    )
    ajustado = await cliente.patch(
        f"{EVENTS}/{evento_id}",
        headers=cabeceras,
        json={"registration_opens_at": inscripcion.isoformat()},
    )
    assert ajustado.status_code == 200, ajustado.text
    assert (await _publicar(cliente, cabeceras, evento_id)).status_code == 200

    ficha = (await cliente.get(_ficha(organizacion, "apertura-mas-tardia"))).json()
    assert datetime.fromisoformat(ficha["ticket_sales_opens_at"]) == inscripcion
