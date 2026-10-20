"""Tipos de sesión por organización: nacen con la organización, están aislados
por RLS, el nombre es único sin distinguir mayúsculas y las sesiones apuntan a
su tipo."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.database import SessionApp, SessionMaintenance, set_organization_context
from app.core.security import hash_password
from app.modules.events.models import SessionType
from app.modules.users.models import User
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_events_public import EVENTS, _crear_evento

CLAVES_BASE = ["talk", "workshop", "break", "service", "other"]


async def _tipos_de(organization_id: object) -> list[SessionType]:
    async with SessionMaintenance() as session:
        return list(
            await session.scalars(
                select(SessionType)
                .where(SessionType.organization_id == organization_id)
                .order_by(SessionType.display_order)
            )
        )


async def test_el_alta_por_superadmin_crea_los_cinco_tipos_base(
    organizacion: OrganizacionDePrueba,
) -> None:
    tipos = await _tipos_de(organizacion.id)

    assert [tipo.base_key for tipo in tipos] == CLAVES_BASE
    assert [tipo.name for tipo in tipos] == ["Charla", "Taller", "Descanso", "Servicio", "Otro"]
    assert [tipo.is_break for tipo in tipos] == [False, False, True, True, False]


async def test_el_alta_por_autoservicio_tambien_los_crea(cliente: AsyncClient) -> None:
    async with SessionMaintenance() as session:
        session.add(
            User(
                email="nueva@example.com",
                first_name="Nueva",
                last_name="Organizadora",
                password_hash=hash_password("contraseña-de-prueba-larga"),
                is_active=True,
                email_verified_at=datetime.now(UTC),
            )
        )
        await session.commit()
    login = await cliente.post(
        "/api/v1/auth/login",
        json={"email": "nueva@example.com", "password": "contraseña-de-prueba-larga"},
    )
    assert login.status_code == 200, login.text
    cabeceras = {"Authorization": f"Bearer {login.json()['access_token']}"}

    alta = await cliente.post(
        "/api/v1/organizations",
        headers=cabeceras,
        json={
            "name": "Autoservicio",
            "slug": "autoservicio-tipos",
            "first_name": "Nueva",
            "last_name": "Organizadora",
            "turnstile_token": "token-de-prueba",
        },
    )

    assert alta.status_code == 201, alta.text
    async with SessionMaintenance() as session:
        org_id = await session.scalar(
            text("SELECT id FROM organizations WHERE slug = 'autoservicio-tipos'")
        )
    assert [tipo.base_key for tipo in await _tipos_de(org_id)] == CLAVES_BASE


async def test_una_organizacion_no_ve_los_tipos_de_otra(
    organizacion: OrganizacionDePrueba, otra_organizacion: OrganizacionDePrueba
) -> None:
    async with SessionApp() as session:
        await set_organization_context(session, organizacion.id)
        visibles = list(await session.scalars(select(SessionType)))

    assert visibles
    assert {tipo.organization_id for tipo in visibles} == {organizacion.id}


async def test_el_nombre_es_unico_sin_distinguir_mayusculas_ni_espacios(
    organizacion: OrganizacionDePrueba,
) -> None:
    async with SessionMaintenance() as session:
        session.add(
            SessionType(
                organization_id=organizacion.id, name=" charla ", color="azul", display_order=9
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()


async def test_cada_sesion_apunta_al_tipo_de_su_clave(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-tipos")
    inicio = datetime.fromisoformat(evento["starts_at"])
    for orden, clave in enumerate(("workshop", "break")):
        respuesta = await cliente.post(
            f"{EVENTS}/{evento['id']}/sessions",
            headers=cabeceras,
            json={
                "session_type": clave,
                "title": f"Sesión {clave}",
                "starts_at": (inicio + timedelta(hours=orden + 1)).isoformat(),
                "ends_at": (inicio + timedelta(hours=orden + 2)).isoformat(),
            },
        )
        assert respuesta.status_code == 201, respuesta.text

    async with SessionMaintenance() as session:
        filas = (
            await session.execute(
                text(
                    "SELECT s.session_type, t.base_key FROM event_sessions s "
                    "JOIN session_types t ON t.id = s.session_type_id ORDER BY s.starts_at"
                )
            )
        ).all()

    assert [tuple(fila) for fila in filas] == [("workshop", "workshop"), ("break", "break")]
