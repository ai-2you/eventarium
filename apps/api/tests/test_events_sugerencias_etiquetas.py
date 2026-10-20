"""Sugerencias de etiquetas para el autocompletado del formulario de evento."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba, iniciar_sesion, iniciar_sesion_como

EVENTS = "/api/v1/events"
TAGS = "/api/v1/events/tags"
AHORA = datetime.now(UTC).replace(microsecond=0)


async def _crear(
    cliente: AsyncClient, cabeceras: dict[str, str], slug: str, tags: list[str]
) -> None:
    respuesta = await cliente.post(
        EVENTS,
        headers=cabeceras,
        json={
            "slug": slug,
            "title": f"Evento {slug}",
            "starts_at": (AHORA + timedelta(days=5)).isoformat(),
            "ends_at": (AHORA + timedelta(days=6)).isoformat(),
            "location_mode": "in_person",
            "tags": tags,
        },
    )
    assert respuesta.status_code == 201, respuesta.text


async def test_sin_texto_devuelve_las_mas_usadas_primero(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    await _crear(cliente, cabeceras, "uno", ["ia", "datos"])
    await _crear(cliente, cabeceras, "dos", ["ia", "robotica"])
    await _crear(cliente, cabeceras, "tres", ["ia", "datos"])

    respuesta = await cliente.get(TAGS, headers=cabeceras)

    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json() == ["ia", "datos", "robotica"]


async def test_con_texto_filtra_y_prioriza_las_que_empiezan_por_el(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    await _crear(cliente, cabeceras, "uno", ["big data", "datos", "ia"])
    await _crear(cliente, cabeceras, "dos", ["big data"])

    respuesta = await cliente.get(TAGS, headers=cabeceras, params={"q": "  DAT "})

    assert respuesta.json() == ["datos", "big data"]


async def test_los_comodines_de_like_se_tratan_como_texto(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    await _crear(cliente, cabeceras, "uno", ["datos", "ia"])

    respuesta = await cliente.get(TAGS, headers=cabeceras, params={"q": "%"})

    assert respuesta.json() == []


async def test_no_mezcla_etiquetas_de_otra_organizacion(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    otra_organizacion: OrganizacionDePrueba,
) -> None:
    _, cabeceras_otra = await iniciar_sesion(cliente, otra_organizacion)
    await _crear(cliente, cabeceras_otra, "ajeno", ["secreta"])
    _, cabeceras = await iniciar_sesion(cliente, organizacion)

    respuesta = await cliente.get(TAGS, headers=cabeceras)

    assert respuesta.json() == []


async def test_sin_permiso_de_eventos_no_hay_sugerencias(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras_ponente = await iniciar_sesion_como(cliente, organizacion, "speaker")

    respuesta = await cliente.get(TAGS, headers=cabeceras_ponente)

    assert respuesta.status_code == 403
