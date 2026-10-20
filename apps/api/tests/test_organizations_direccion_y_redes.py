"""Dirección en partes con su casilla de visibilidad y redes con tipo cerrado,
editadas en la ficha de la organización; guardar «Marca» no las toca."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from httpx import AsyncClient

from tests.conftest import OrganizacionDePrueba, iniciar_sesion

ME = "/api/v1/organizations/me"
PUBLICO = "/api/v1/public/organizations"
REDES = [
    {"kind": "instagram", "url": "https://instagram.com/acme"},
    {"kind": "other", "url": "https://mastodon.social/@acme", "label": "Mastodon"},
]


async def test_guarda_direccion_y_redes_y_marca_no_las_borra(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)

    guardado = await cliente.patch(
        ME,
        headers=cabeceras,
        json={
            "address": "Calle Mayor 1",
            "postal_code": "46001",
            "city": "Valencia",
            "province": "Valencia",
            "social_links": REDES,
            "public_page_enabled": True,
        },
    )
    marca = await cliente.put(f"{ME}/branding", headers=cabeceras, json={"organizer_blurb": "Hola"})
    ficha = (await cliente.get(ME, headers=cabeceras)).json()

    assert guardado.status_code == 200, guardado.text
    assert marca.status_code == 200, marca.text
    assert (ficha["postal_code"], ficha["city"], ficha["address_public"]) == (
        "46001",
        "Valencia",
        True,
    )
    assert [red["kind"] for red in ficha["social_links"]] == ["instagram", "other"]
    publica = (await cliente.get(f"{PUBLICO}/{organizacion.slug}")).json()
    assert publica["city"] == "Valencia"
    assert publica["social_links"][1]["label"] == "Mastodon"
    assert publica["social_links"][0]["label"] is None


async def test_sin_la_casilla_la_direccion_no_es_publica(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    await cliente.patch(
        ME,
        headers=cabeceras,
        json={
            "address": "Calle Mayor 1",
            "city": "Valencia",
            "address_public": False,
            "public_page_enabled": True,
        },
    )

    publica = (await cliente.get(f"{PUBLICO}/{organizacion.slug}")).json()

    assert (publica["address"], publica["city"], publica["postal_code"]) == (None, None, None)
    assert (await cliente.get(ME, headers=cabeceras)).json()["city"] == "Valencia"


@pytest.mark.parametrize(
    "redes",
    [
        [
            {"kind": "instagram", "url": "https://a.example"},
            {"kind": "instagram", "url": "https://b.example"},
        ],
        [{"kind": "other", "url": "https://a.example"}],
        [{"kind": "myspace", "url": "https://a.example"}],
        [{"kind": "x", "url": "ftp://a.example"}],
    ],
    ids=["repetida", "libre-sin-nombre", "tipo-desconocido", "url"],
)
async def test_valida_las_redes(
    cliente: AsyncClient, organizacion: OrganizacionDePrueba, redes: list
) -> None:
    _, cabeceras = await iniciar_sesion(cliente, organizacion)
    respuesta = await cliente.patch(ME, headers=cabeceras, json={"social_links": redes})
    assert respuesta.status_code == 422


def test_la_migracion_normaliza_las_redes_existentes() -> None:
    ruta = Path(__file__).parents[1] / "alembic/versions/0067_direccion_y_redes_org.py"
    spec = importlib.util.spec_from_file_location("migracion_0067", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)  # type: ignore[union-attr]

    resultado = modulo.normalizar(
        [
            {"kind": "Instagram", "url": "https://instagram.com/a"},
            {"kind": "web", "url": "https://acme.example"},
            {"kind": "twitter", "url": "https://twitter.com/a"},
            {"kind": "Mi red", "url": "https://www.linkedin.com/company/a"},
            {"kind": "instagram", "url": "https://instagram.com/b"},
            {"kind": "web", "url": ""},
        ]
    )

    assert resultado == [
        {"kind": "instagram", "url": "https://instagram.com/a", "label": None},
        {"kind": "other", "url": "https://acme.example", "label": "Web"},
        {"kind": "x", "url": "https://twitter.com/a", "label": None},
        {"kind": "linkedin", "url": "https://www.linkedin.com/company/a", "label": None},
    ]
