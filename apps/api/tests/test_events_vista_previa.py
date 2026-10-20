"""Vista previa de la ficha pública desde el panel: cualquier estado, solo el
equipo de la organización."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import (
    OrganizacionDePrueba,
    crear_miembro,
    iniciar_sesion,
    iniciar_sesion_con,
)
from tests.test_events_public import EVENTOS_DE_ACME, EVENTS, _crear_evento


async def test_un_borrador_se_ve_en_vista_previa_y_no_en_publico(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="borrador-previo")

    previa = await cliente.get(f"{EVENTS}/{evento['id']}/preview", headers=cabeceras)
    publica = await cliente.get(f"{EVENTOS_DE_ACME}/borrador-previo")

    assert previa.status_code == 200, previa.text
    assert previa.json()["slug"] == "borrador-previo"
    assert previa.json()["organization"]["slug"] == organizacion.slug
    assert publica.status_code == 404


async def test_la_vista_previa_exige_ver_eventos_y_ser_de_la_organizacion(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    otra_organizacion: OrganizacionDePrueba,
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="solo-equipo")
    ponente = await crear_miembro(organizacion, "speaker")
    _, cabeceras_ponente = await iniciar_sesion_con(
        cliente, organizacion, ponente.email, ponente.password
    )
    _, cabeceras_ajenas = await iniciar_sesion(cliente, otra_organizacion)

    url = f"{EVENTS}/{evento['id']}/preview"
    assert (await cliente.get(url)).status_code == 401
    assert (await cliente.get(url, headers=cabeceras_ponente)).status_code == 403
    assert (await cliente.get(url, headers=cabeceras_ajenas)).status_code == 404


async def test_un_identificador_que_no_es_un_evento_da_404(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)

    respuesta = await cliente.get(f"{EVENTS}/no-es-un-uuid/preview", headers=cabeceras)

    assert respuesta.status_code == 404
