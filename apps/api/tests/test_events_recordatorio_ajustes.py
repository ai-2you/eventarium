"""Ajustes del recordatorio a los inscritos y zona horaria del evento: valores
por defecto (48 h en los de pago), conjunto cerrado de horas, validación IANA,
el MCP y el backfill de la migración para los eventos existentes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from app.modules.events.models import Event
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.mcp_test_helpers import _crear_clave, _datos, _herramienta
from tests.test_events_categorias import _superadmin
from tests.test_events_public import EVENTS, _payload_evento
from tests.test_payments_migracion import _correr_alembic


async def _crear(cliente: AsyncClient, cabeceras: dict[str, str], slug: str, **extra: object):
    return await cliente.post(EVENTS, headers=cabeceras, json=_payload_evento(slug, **extra))


async def test_por_defecto_24_horas_y_48_en_los_de_pago(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)

    gratis = (await _crear(cliente, cabeceras, "recordatorio-gratis")).json()
    de_pago = (
        await _crear(cliente, cabeceras, "recordatorio-pago", registration_mode="paid")
    ).json()

    assert (gratis["reminder_enabled"], gratis["reminder_hours_before"]) == (True, 24)
    assert de_pago["reminder_hours_before"] == 48
    assert gratis["attendance_closed_at"] is None


async def test_se_elige_y_se_cambia_dentro_del_conjunto_cerrado(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    creado = await _crear(
        cliente, cabeceras, "recordatorio-elegido", reminder_hours_before=6, reminder_enabled=False
    )
    assert creado.status_code == 201, creado.text
    assert (creado.json()["reminder_enabled"], creado.json()["reminder_hours_before"]) == (False, 6)

    cambiado = await cliente.patch(
        f"{EVENTS}/{creado.json()['id']}",
        headers=cabeceras,
        json={"reminder_hours_before": 72, "reminder_enabled": True},
    )
    assert cambiado.status_code == 200, cambiado.text
    assert (cambiado.json()["reminder_enabled"], cambiado.json()["reminder_hours_before"]) == (
        True,
        72,
    )

    fuera = await cliente.patch(
        f"{EVENTS}/{creado.json()['id']}", headers=cabeceras, json={"reminder_hours_before": 5}
    )
    assert fuera.status_code == 422


async def test_una_zona_horaria_desconocida_se_rechaza_al_crear_y_al_editar(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)

    assert (await _crear(cliente, cabeceras, "zona-mala", timezone="Madrid")).status_code == 422

    creado = (await _crear(cliente, cabeceras, "zona-buena", timezone="America/Bogota")).json()
    assert creado["timezone"] == "America/Bogota"
    editado = await cliente.patch(
        f"{EVENTS}/{creado['id']}", headers=cabeceras, json={"timezone": "Hora/Inventada"}
    )
    assert editado.status_code == 422
    assert "zona horaria" in editado.text


async def test_el_mcp_respeta_los_valores_por_defecto_y_el_conjunto(
    cliente: AsyncClient, cliente_mcp: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    cabeceras = await _superadmin(cliente, organizacion)
    clave = (await _crear_clave(cliente, cabeceras, scopes=["eventos:leer", "eventos:editar"]))[
        "api_key"
    ]
    ahora = datetime.now(UTC).replace(microsecond=0)
    fechas = {
        "inicio": (ahora + timedelta(days=5)).isoformat(),
        "fin": (ahora + timedelta(days=6)).isoformat(),
    }

    de_pago = _datos(
        await _herramienta(
            cliente_mcp,
            clave,
            "crear_evento",
            slug="mcp-pago",
            titulo="De pago",
            modo_inscripcion="paid",
            **fechas,
        )
    )
    apagado = _datos(
        await _herramienta(
            cliente_mcp,
            clave,
            "crear_evento",
            slug="mcp-apagado",
            titulo="Sin recordatorio",
            recordatorio=False,
            recordatorio_horas=2,
            **fechas,
        )
    )
    invalido = await _herramienta(
        cliente_mcp,
        clave,
        "editar_evento",
        event_id=apagado["id"],
        recordatorio_horas=5,
    )

    async with SessionMaintenance() as session:
        pago = await session.get(Event, uuid.UUID(de_pago["id"]))
        sin = await session.get(Event, uuid.UUID(apagado["id"]))
        assert pago.reminder_hours_before == 48
        assert (sin.reminder_enabled, sin.reminder_hours_before) == (False, 2)
    assert invalido.get("isError")


@pytest.mark.parametrize("horas", [10, 100])
async def test_la_migracion_no_lanza_recordatorios_de_los_que_empiezan_en_72_horas(
    organizacion: OrganizacionDePrueba, horas: int
) -> None:
    ahora = datetime.now(UTC)
    async with SessionMaintenance() as session:
        evento = Event(
            organization_id=organizacion.id,
            slug=f"antes-de-la-migracion-{horas}",
            title="Evento anterior a la migración",
            status="published",
            visibility="public",
            starts_at=ahora + timedelta(hours=horas),
            ends_at=ahora + timedelta(hours=horas + 2),
            location_mode="online",
            registration_mode="paid",
        )
        session.add(evento)
        await session.commit()
        evento_id = evento.id

    _correr_alembic("downgrade", "-1")
    _correr_alembic("upgrade", "head")

    async with SessionMaintenance() as session:
        activado, horas_antes = (
            await session.execute(
                text("SELECT reminder_enabled, reminder_hours_before FROM events WHERE id = :id"),
                {"id": evento_id},
            )
        ).one()
    assert activado is (horas > 72)
    assert horas_antes == 48
