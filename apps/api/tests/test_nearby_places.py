"""Sitios cercanos de un evento: alta, validación, orden, copia entre eventos,
ficha pública y aislamiento entre organizaciones."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.modules.nearby import service as nearby_service
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.test_events_public import EVENTOS_DE_ACME, EVENTS, _crear_evento, _publicar

HOTEL = {
    "kind": "hotel",
    "name": "Hotel Mar",
    "address": "Paseo Marítimo 3",
    "phone": "+34 961 23 45 67",
    "website": "https://hotelmar.example",
    "notes": "10 % con el código EVENTO",
}


def _url(evento: dict) -> str:
    return f"{EVENTS}/{evento['id']}/nearby-places"


async def test_alta_edicion_borrado_y_ficha_publica(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="con-cercanos")

    hotel = await cliente.post(_url(evento), headers=cabeceras, json=HOTEL)
    gimnasio = await cliente.post(
        _url(evento),
        headers=cabeceras,
        json={"kind": "other", "custom_kind": "Gimnasio", "name": "Gym 24h"},
    )
    assert hotel.status_code == 201, hotel.text
    assert gimnasio.status_code == 201, gimnasio.text

    editado = await cliente.patch(
        f"{_url(evento)}/{hotel.json()['id']}", headers=cabeceras, json={"notes": "  "}
    )
    assert editado.status_code == 200
    assert editado.json()["notes"] is None

    await _publicar(cliente, cabeceras, evento["id"])
    ficha = (await cliente.get(f"{EVENTOS_DE_ACME}/con-cercanos")).json()
    assert [sitio["name"] for sitio in ficha["nearby_places"]] == ["Hotel Mar", "Gym 24h"]
    assert ficha["nearby_places"][1]["custom_kind"] == "Gimnasio"
    assert "display_order" not in ficha["nearby_places"][0]

    borrado = await cliente.delete(f"{_url(evento)}/{gimnasio.json()['id']}", headers=cabeceras)
    assert borrado.status_code == 204
    assert len((await cliente.get(_url(evento), headers=cabeceras)).json()) == 1


@pytest.mark.parametrize(
    "cuerpo",
    [
        {"kind": "other", "name": "Sin tipo libre"},
        {"kind": "hotel", "custom_kind": "Sobra", "name": "Con tipo libre"},
        {"kind": "hotel", "name": "Teléfono malo", "phone": "llámame"},
        {"kind": "hotel", "name": "Web mala", "website": "javascript:alert(1)"},
        {"kind": "spa", "name": "Tipo desconocido"},
        {"kind": "hotel", "name": "   "},
        {"kind": "hotel", "name": "Teléfono largo", "phone": "+34600000000000000000"},
    ],
    ids=["otro-sin-nombre", "libre-sin-otro", "telefono", "web", "tipo", "nombre-vacio", "largo"],
)
async def test_valida_los_datos(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, cuerpo: dict
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="validacion-cercanos")

    assert (await cliente.post(_url(evento), headers=cabeceras, json=cuerpo)).status_code == 422


async def test_hay_un_maximo_por_evento(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(nearby_service, "MAXIMO_POR_EVENTO", 1)
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="tope-cercanos")

    assert (await cliente.post(_url(evento), headers=cabeceras, json=HOTEL)).status_code == 201
    assert (await cliente.post(_url(evento), headers=cabeceras, json=HOTEL)).status_code == 422


async def test_reordenar_exige_todos_los_sitios(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="orden-cercanos")
    a = (await cliente.post(_url(evento), headers=cabeceras, json=HOTEL)).json()
    b = (
        await cliente.post(
            _url(evento), headers=cabeceras, json={"kind": "parking", "name": "Parking Centro"}
        )
    ).json()

    reordenado = await cliente.put(
        f"{_url(evento)}/order", headers=cabeceras, json={"ids": [b["id"], a["id"]]}
    )
    incompleto = await cliente.put(
        f"{_url(evento)}/order", headers=cabeceras, json={"ids": [a["id"]]}
    )

    assert [sitio["name"] for sitio in reordenado.json()] == ["Parking Centro", "Hotel Mar"]
    assert incompleto.status_code == 422


async def test_copiar_de_otro_evento_de_la_organizacion(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    origen = await _crear_evento(cliente, cabeceras, slug="edicion-2025")
    destino = await _crear_evento(cliente, cabeceras, slug="edicion-2026")
    await cliente.post(_url(origen), headers=cabeceras, json=HOTEL)

    copiado = await cliente.post(f"{_url(destino)}/copy-from/{origen['id']}", headers=cabeceras)
    al_mismo = await cliente.post(f"{_url(destino)}/copy-from/{destino['id']}", headers=cabeceras)

    assert copiado.status_code == 200, copiado.text
    assert [sitio["name"] for sitio in copiado.json()] == ["Hotel Mar"]
    assert al_mismo.status_code == 422


async def test_otra_organizacion_no_ve_ni_copia_los_sitios(
    cliente: AsyncClient,
    organizacion: OrganizacionDePrueba,
    otra_organizacion: OrganizacionDePrueba,
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    _, cabeceras_ajenas = await iniciar_sesion(cliente, otra_organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="cercanos-privados")
    sitio = (await cliente.post(_url(evento), headers=cabeceras, json=HOTEL)).json()
    suyo = await _crear_evento(cliente, cabeceras_ajenas, slug="evento-ajeno")

    assert (await cliente.get(_url(evento), headers=cabeceras_ajenas)).status_code == 404
    editar = await cliente.patch(
        f"{_url(evento)}/{sitio['id']}", headers=cabeceras_ajenas, json={"name": "Robado"}
    )
    assert editar.status_code == 404
    copiar = await cliente.post(f"{_url(suyo)}/copy-from/{evento['id']}", headers=cabeceras_ajenas)
    assert copiar.status_code == 404


async def test_editar_no_admite_nulos_en_lo_obligatorio_y_un_id_malo_da_404(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    evento = await _crear_evento(cliente, cabeceras, slug="nulos-cercanos")
    sitio = (await cliente.post(_url(evento), headers=cabeceras, json=HOTEL)).json()

    for campo in ("kind", "name"):
        respuesta = await cliente.patch(
            f"{_url(evento)}/{sitio['id']}", headers=cabeceras, json={campo: None}
        )
        assert respuesta.status_code == 422, respuesta.text
    assert (
        await cliente.get(f"{EVENTS}/no-es-un-id/nearby-places", headers=cabeceras)
    ).status_code == 404
    malo = await cliente.patch(
        f"{_url(evento)}/no-es-un-id", headers=cabeceras, json={"notes": "x"}
    )
    assert malo.status_code == 404
