"""Subir el aforo desde el MCP ofrece la plaza a la lista de espera y su correo
sale tras guardar (la sesión del MCP despacha lo encolado, como la web)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient

from app.core.database import SessionMaintenance
from app.modules.registrations import service as registrations_service
from app.modules.registrations.models import EventRegistration
from tests.conftest import OrganizacionDePrueba
from tests.mcp_test_helpers import _crear_clave, _datos, _herramienta
from tests.test_events_categorias import _superadmin
from tests.test_events_public import EVENTS


async def test_subir_el_aforo_por_mcp_envia_el_correo_de_la_plaza(
    cliente: AsyncClient,
    cliente_mcp: AsyncClient,
    organizacion: OrganizacionDePrueba,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    envio = AsyncMock()
    monkeypatch.setattr(registrations_service.send_waitlist_promotion_email, "kiq", envio)
    cabeceras = await _superadmin(cliente, organizacion)
    clave = (await _crear_clave(cliente, cabeceras, scopes=["eventos:leer", "eventos:editar"]))[
        "api_key"
    ]
    ahora = datetime.now(UTC).replace(microsecond=0)
    evento = (
        await cliente.post(
            EVENTS,
            headers=cabeceras,
            json={
                "slug": "aforo-por-mcp",
                "title": "Aforo por MCP",
                "starts_at": (ahora + timedelta(days=3)).isoformat(),
                "ends_at": (ahora + timedelta(days=4)).isoformat(),
                "location_mode": "online",
                "capacity": 1,
                "status": "published",
            },
        )
    ).json()
    async with SessionMaintenance() as session:
        for correo, estado in (
            ("dentro@example.com", "confirmed"),
            ("espera@example.com", "waitlisted"),
        ):
            session.add(
                EventRegistration(
                    event_id=uuid.UUID(evento["id"]),
                    organization_id=organizacion.id,
                    email=correo,
                    full_name="Asistente",
                    status=estado,
                    confirmed_at=ahora if estado == "confirmed" else None,
                )
            )
        await session.commit()

    _datos(await _herramienta(cliente_mcp, clave, "editar_evento", event_id=evento["id"], aforo=2))

    envio.assert_awaited_once()
    assert envio.await_args.args[0] == "espera@example.com"
