"""Ponentes enlazados a un evento en su ficha pública (`speakers`), tengan o no
sesión en la agenda."""

from __future__ import annotations

import json
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from tests.conftest import (
    MiembroDePrueba,
    OrganizacionDePrueba,
    crear_miembro,
    iniciar_sesion,
    iniciar_sesion_con,
)
from tests.test_events_public import AHORA, EVENTOS_DE_ACME, EVENTS, _crear_evento, _publicar


async def _al_roster(
    cliente: AsyncClient, cabeceras: dict[str, str], evento_id: str, miembro: MiembroDePrueba
) -> str:
    respuesta = await cliente.post(
        f"{EVENTS}/{evento_id}/members",
        headers=cabeceras,
        json={"organization_member_id": str(miembro.member_id)},
    )
    assert respuesta.status_code == 201, respuesta.text
    return str(respuesta.json()["id"])


async def _renombrar(miembro: MiembroDePrueba, nombre: str, apellidos: str) -> None:
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE users SET first_name = :n, last_name = :a WHERE id = :id"),
            {"n": nombre, "a": apellidos, "id": miembro.user_id},
        )
        await session.commit()


async def test_los_ponentes_del_roster_salen_aunque_no_tengan_sesion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-roster")
    ana = await crear_miembro(organizacion, "speaker", email="ana@acme.example")
    tocaya = await crear_miembro(organizacion, "speaker", email="tocaya@acme.example")
    baja = await crear_miembro(organizacion, "speaker", email="baja@acme.example")
    organizador = await crear_miembro(organizacion, "organizer")
    for miembro, nombre in ((ana, "Ana"), (tocaya, "Ana"), (baja, "Baja")):
        await _renombrar(miembro, nombre, "Pérez")
    for miembro in (ana, tocaya, baja, organizador):
        await _al_roster(cliente, cabeceras, evento["id"], miembro)
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE users SET is_active = false WHERE id = :id"), {"id": baja.user_id}
        )
        await session.commit()
    await _publicar(cliente, cabeceras, evento["id"])

    respuesta = await cliente.get(f"{EVENTOS_DE_ACME}/con-roster")

    assert respuesta.status_code == 200, respuesta.text
    ponentes = respuesta.json()["speakers"]
    assert [p["display_name"] for p in ponentes] == ["Ana Pérez", "Ana Pérez"]
    assert all(p["public_slug"] is None and p["role_key"] == "speaker" for p in ponentes)
    assert ponentes[0]["ref"] != ponentes[1]["ref"]
    crudo = json.dumps(ponentes)
    assert "@acme.example" not in crudo
    assert str(ana.user_id) not in crudo and str(ana.member_id) not in crudo


async def test_el_ref_coincide_con_la_agenda_y_el_perfil_publico_se_enlaza(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    ponente = await crear_miembro(organizacion, "speaker")
    _, cabeceras_ponente = await iniciar_sesion_con(
        cliente, organizacion, ponente.email, ponente.password
    )
    activado = await cliente.patch(
        "/api/v1/users/me/public-profile",
        headers=cabeceras_ponente,
        json={
            "public_slug": "ponente-enlazada",
            "source_organization_member_id": str(ponente.member_id),
        },
    )
    assert activado.status_code == 200, activado.text
    evento = await _crear_evento(cliente, cabeceras, slug="con-agenda")
    sesion = (
        await cliente.post(
            f"{EVENTS}/{evento['id']}/sessions",
            headers=cabeceras,
            json={
                "session_type": "talk",
                "title": "Su charla",
                "starts_at": (AHORA + timedelta(hours=1)).isoformat(),
                "ends_at": (AHORA + timedelta(hours=2)).isoformat(),
            },
        )
    ).json()
    miembro_evento = await _al_roster(cliente, cabeceras, evento["id"], ponente)
    await cliente.put(
        f"{EVENTS}/{evento['id']}/sessions/{sesion['id']}/participants",
        headers=cabeceras,
        json={
            "expected_updated_at": sesion["updated_at"],
            "participants": [{"event_member_id": miembro_evento, "role_key": "speaker"}],
        },
    )
    await _publicar(cliente, cabeceras, evento["id"])

    detalle = (await cliente.get(f"{EVENTOS_DE_ACME}/con-agenda")).json()

    (en_roster,) = detalle["speakers"]
    (en_agenda,) = detalle["sessions"][0]["participants"]
    assert en_roster["public_slug"] == "ponente-enlazada"
    assert en_roster["ref"] == en_agenda["ref"]


async def test_una_cuenta_de_baja_no_sale_ni_por_la_agenda(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    ponente = await crear_miembro(organizacion, "speaker")
    evento = await _crear_evento(cliente, cabeceras, slug="con-baja")
    sesion = (
        await cliente.post(
            f"{EVENTS}/{evento['id']}/sessions",
            headers=cabeceras,
            json={
                "session_type": "talk",
                "title": "Charla",
                "starts_at": (AHORA + timedelta(hours=1)).isoformat(),
                "ends_at": (AHORA + timedelta(hours=2)).isoformat(),
            },
        )
    ).json()
    miembro_evento = await _al_roster(cliente, cabeceras, evento["id"], ponente)
    await cliente.put(
        f"{EVENTS}/{evento['id']}/sessions/{sesion['id']}/participants",
        headers=cabeceras,
        json={
            "expected_updated_at": sesion["updated_at"],
            "participants": [{"event_member_id": miembro_evento, "role_key": "speaker"}],
        },
    )
    await _publicar(cliente, cabeceras, evento["id"])
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE users SET is_active = false WHERE id = :id"), {"id": ponente.user_id}
        )
        await session.commit()

    detalle = (await cliente.get(f"{EVENTOS_DE_ACME}/con-baja")).json()
    de_la_sesion = (await cliente.get(f"{EVENTOS_DE_ACME}/con-baja/sessions/{sesion['id']}")).json()

    assert detalle["speakers"] == []
    assert detalle["sessions"][0]["participants"] == []
    assert de_la_sesion["participants"] == []


async def test_el_perfil_publico_de_una_cuenta_de_baja_no_existe(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    ponente = await crear_miembro(organizacion, "speaker")
    _, cabeceras = await iniciar_sesion_con(cliente, organizacion, ponente.email, ponente.password)
    activado = await cliente.patch(
        "/api/v1/users/me/public-profile",
        headers=cabeceras,
        json={
            "public_slug": "se-da-de-baja",
            "source_organization_member_id": str(ponente.member_id),
        },
    )
    assert activado.status_code == 200, activado.text
    assert (await cliente.get("/api/v1/public/speakers/se-da-de-baja")).status_code == 200

    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE users SET is_active = false WHERE id = :id"), {"id": ponente.user_id}
        )
        await session.commit()

    assert (await cliente.get("/api/v1/public/speakers/se-da-de-baja")).status_code == 404
