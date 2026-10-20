"""API de tipos de sesión de la organización y su uso en las sesiones."""

from __future__ import annotations

from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from tests.conftest import (
    OrganizacionDePrueba,
    crear_miembro,
    iniciar_sesion,
    iniciar_sesion_con,
)
from tests.test_events_public import EVENTOS_DE_ACME, EVENTS, _crear_evento, _publicar

TIPOS = "/api/v1/organizations/me/session-types"


async def _tipos(cliente: AsyncClient, cabeceras: dict[str, str]) -> list[dict]:
    respuesta = await cliente.get(TIPOS, headers=cabeceras)
    assert respuesta.status_code == 200, respuesta.text
    return list(respuesta.json())


async def _sesion(
    cliente: AsyncClient, cabeceras: dict[str, str], evento: dict, **campos: object
) -> dict:
    inicio = datetime.fromisoformat(evento["starts_at"])
    respuesta = await cliente.post(
        f"{EVENTS}/{evento['id']}/sessions",
        headers=cabeceras,
        json={
            "title": "Sesión",
            "starts_at": (inicio + timedelta(hours=1)).isoformat(),
            "ends_at": (inicio + timedelta(hours=2)).isoformat(),
            **campos,
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return dict(respuesta.json())


async def test_crear_un_tipo_propio_y_usarlo_en_una_sesion_publica(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    creado = await cliente.post(
        TIPOS,
        headers=cabeceras,
        json={"name": "  Mesa   redonda ", "color": "rosa", "description": "Debate"},
    )
    assert creado.status_code == 201, creado.text
    tipo = creado.json()
    assert (tipo["name"], tipo["base_key"], tipo["sesiones"]) == ("Mesa redonda", None, 0)

    evento = await _crear_evento(cliente, cabeceras, slug="con-mesa")
    sesion = await _sesion(cliente, cabeceras, evento, session_type_id=tipo["id"])
    await _publicar(cliente, cabeceras, evento["id"])
    ficha = (await cliente.get(f"{EVENTOS_DE_ACME}/con-mesa")).json()

    assert sesion["type"] == {
        "id": tipo["id"],
        "name": "Mesa redonda",
        "color": "rosa",
        "is_break": False,
    }
    assert sesion["session_type"] == "other"
    assert ficha["sessions"][0]["type"]["name"] == "Mesa redonda"


async def test_sin_tipo_usa_el_primero_activo_que_no_es_pausa(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="sin-tipo")

    sesion = await _sesion(cliente, cabeceras, evento)

    assert sesion["type"]["name"] == "Charla"


async def test_nombre_repetido_da_409(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)

    respuesta = await cliente.post(TIPOS, headers=cabeceras, json={"name": "CHARLA"})

    assert respuesta.status_code == 409
    assert "Ya hay un tipo" in respuesta.text


async def test_un_tipo_en_uso_no_se_borra_se_desactiva_y_la_sesion_lo_conserva(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    taller = next(t for t in await _tipos(cliente, cabeceras) if t["base_key"] == "workshop")
    evento = await _crear_evento(cliente, cabeceras, slug="con-taller-api")
    sesion = await _sesion(cliente, cabeceras, evento, session_type_id=taller["id"])

    borrar = await cliente.delete(f"{TIPOS}/{taller['id']}", headers=cabeceras)
    desactivar = await cliente.patch(
        f"{TIPOS}/{taller['id']}", headers=cabeceras, json={"is_active": False}
    )
    nueva = await cliente.post(
        f"{EVENTS}/{evento['id']}/sessions",
        headers=cabeceras,
        json={
            "title": "Otra",
            "session_type_id": taller["id"],
            "starts_at": sesion["starts_at"],
            "ends_at": sesion["ends_at"],
        },
    )
    renombrada = await cliente.patch(
        f"{EVENTS}/{evento['id']}/sessions/{sesion['id']}",
        headers=cabeceras,
        json={"title": "Renombrada", "session_type_id": taller["id"]},
    )
    activos = await cliente.get(TIPOS, headers=cabeceras, params={"activos": True})

    assert borrar.status_code == 409
    assert desactivar.status_code == 200, desactivar.text
    assert desactivar.json()["sesiones"] == 1
    assert nueva.status_code == 422
    assert renombrada.status_code == 200, renombrada.text
    assert renombrada.json()["type"]["id"] == taller["id"]
    assert taller["id"] not in {t["id"] for t in activos.json()}


async def test_un_tipo_sin_uso_se_borra_y_siempre_queda_uno_activo(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    tipos = await _tipos(cliente, cabeceras)
    *resto, ultimo = tipos
    for tipo in resto:
        respuesta = await cliente.delete(f"{TIPOS}/{tipo['id']}", headers=cabeceras)
        assert respuesta.status_code == 204, respuesta.text

    sin_ninguno = await cliente.delete(f"{TIPOS}/{ultimo['id']}", headers=cabeceras)
    desactivar = await cliente.patch(
        f"{TIPOS}/{ultimo['id']}", headers=cabeceras, json={"is_active": False}
    )

    assert sin_ninguno.status_code == 409
    assert desactivar.status_code == 409


async def test_reordenar_exige_la_lista_completa(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    ids = [tipo["id"] for tipo in await _tipos(cliente, cabeceras)]

    incompleta = await cliente.put(f"{TIPOS}/order", headers=cabeceras, json={"ids": ids[1:]})
    al_reves = await cliente.put(
        f"{TIPOS}/order", headers=cabeceras, json={"ids": list(reversed(ids))}
    )

    assert incompleta.status_code == 409
    assert al_reves.status_code == 204, al_reves.text
    assert [t["id"] for t in await _tipos(cliente, cabeceras)] == list(reversed(ids))


async def test_permisos_y_aislamiento(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    otra_organizacion: OrganizacionDePrueba,
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    ponente = await crear_miembro(organizacion, "speaker")
    _, cabeceras_ponente = await iniciar_sesion_con(
        cliente, organizacion, ponente.email, ponente.password
    )
    _, cabeceras_ajenas = await iniciar_sesion(cliente, otra_organizacion)
    tipo_propio = (await _tipos(cliente, cabeceras))[0]
    evento = await _crear_evento(cliente, cabeceras, slug="aislado")

    escribir_ponente = await cliente.post(TIPOS, headers=cabeceras_ponente, json={"name": "X"})
    editar_ajeno = await cliente.patch(
        f"{TIPOS}/{tipo_propio['id']}", headers=cabeceras_ajenas, json={"name": "Robado"}
    )
    tipo_ajeno = (await _tipos(cliente, cabeceras_ajenas))[0]
    usar_ajeno = await cliente.post(
        f"{EVENTS}/{evento['id']}/sessions",
        headers=cabeceras,
        json={
            "title": "Con tipo ajeno",
            "session_type_id": tipo_ajeno["id"],
            "starts_at": evento["starts_at"],
            "ends_at": evento["ends_at"],
        },
    )

    assert escribir_ponente.status_code == 403
    assert editar_ajeno.status_code == 404
    assert usar_ajeno.status_code == 404


async def test_una_organizacion_sin_tipos_los_recibe_al_crear_una_sesion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    async with SessionMaintenance() as session:
        await session.execute(
            text("DELETE FROM session_types WHERE organization_id = :o"), {"o": organizacion.id}
        )
        await session.commit()
    evento = await _crear_evento(cliente, cabeceras, slug="sin-tipos")

    sesion = await _sesion(cliente, cabeceras, evento, session_type="workshop")

    assert sesion["type"]["name"] == "Taller"
    assert len(await _tipos(cliente, cabeceras)) == 5
