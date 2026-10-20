"""Eventos «solo con enlace» (`hidden`): se abren por su URL y admiten
inscripción, pero no salen en ningún listado; `private` sigue sin abrirse."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_events_public import (
    EVENTOS_DE_ACME,
    PUBLIC_EVENTS,
    _crear_evento,
    _publicar,
)


async def test_se_abre_por_su_url_y_admite_inscripcion_pero_no_se_lista(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="solo-con-enlace")
    await _publicar(cliente, cabeceras, evento["id"], visibility="hidden")

    ficha = await cliente.get(f"{EVENTOS_DE_ACME}/solo-con-enlace")
    preguntas = await cliente.get(f"{EVENTOS_DE_ACME}/solo-con-enlace/registration-questions")
    portada = await cliente.get(PUBLIC_EVENTS)
    de_la_organizacion = await cliente.get(EVENTOS_DE_ACME)

    assert ficha.status_code == 200, ficha.text
    assert ficha.json()["visibility"] == "hidden"
    assert preguntas.status_code == 200, preguntas.text
    assert "solo-con-enlace" not in portada.text
    assert "solo-con-enlace" not in de_la_organizacion.text


async def test_privado_no_se_abre_ni_para_inscribirse(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="privado-del-todo")
    await _publicar(cliente, cabeceras, evento["id"], visibility="private")

    assert (await cliente.get(f"{EVENTOS_DE_ACME}/privado-del-todo")).status_code == 404
    preguntas = await cliente.get(f"{EVENTOS_DE_ACME}/privado-del-todo/registration-questions")
    assert preguntas.status_code == 404


async def test_un_evento_publico_lleva_su_visibilidad_en_la_ficha(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="publico-normal")
    await _publicar(cliente, cabeceras, evento["id"], visibility="public")

    ficha = await cliente.get(f"{EVENTOS_DE_ACME}/publico-normal")

    assert ficha.json()["visibility"] == "public"
    assert "publico-normal" in (await cliente.get(PUBLIC_EVENTS)).text
