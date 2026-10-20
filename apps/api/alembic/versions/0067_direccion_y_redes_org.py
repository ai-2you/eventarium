"""dirección de la organización en partes y redes con tipo cerrado

`address` pasa a ser la calle; se añaden código postal, ciudad, provincia y si
la dirección se muestra en la página pública (activado: hasta ahora ya se
mostraba). Las redes pasan a un tipo cerrado (LinkedIn, Instagram, X, Facebook,
YouTube, TikTok y un enlace libre con nombre): se normaliza el tipo, se deduce
del dominio si no se reconoce y, si no, pasa a enlace libre con su texto como
nombre; de una red repetida se queda la primera. Medido en producción el
20-oct: 2 Instagram y 1 «web», sin pérdida.

Revision ID: 0067_direccion_y_redes_org
Revises: 0066_sitios_cercanos
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from urllib.parse import urlsplit

import sqlalchemy as sa

from alembic import op

revision: str = "0067_direccion_y_redes_org"
down_revision: str | None = "0066_sitios_cercanos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.0067")

_TIPOS = {"linkedin", "instagram", "x", "facebook", "youtube", "tiktok"}
_ALIAS = {"twitter": "x"}
_DOMINIOS = {
    "linkedin.com": "linkedin",
    "instagram.com": "instagram",
    "x.com": "x",
    "twitter.com": "x",
    "facebook.com": "facebook",
    "fb.com": "facebook",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "tiktok.com": "tiktok",
}


def _por_dominio(url: str) -> str | None:
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.").removeprefix("m.")
    return _DOMINIOS.get(host)


def normalizar(enlaces: list[dict]) -> list[dict]:
    """Las redes con el tipo cerrado; ver el docstring del módulo."""
    resultado: list[dict] = []
    vistos: set[str] = set()
    for enlace in enlaces:
        if not isinstance(enlace, dict):
            continue
        url = str(enlace.get("url") or "").strip()
        if not url:
            continue
        texto = str(enlace.get("kind") or "").strip()
        tipo = _ALIAS.get(texto.lower(), texto.lower())
        etiqueta = None
        if tipo not in _TIPOS:
            tipo = _por_dominio(url) or "other"
        if tipo == "other":
            etiqueta = (str(enlace.get("label") or "") or texto or "Web")[:40].strip()
            if etiqueta.lower() == "web":
                etiqueta = "Web"
        if tipo in vistos:
            logger.warning("Red repetida descartada al normalizar: %s %s", tipo, url)
            continue
        vistos.add(tipo)
        resultado.append({"kind": tipo, "url": url, "label": etiqueta})
    return resultado


def upgrade() -> None:
    op.add_column("organizations", sa.Column("postal_code", sa.String(20), nullable=True))
    op.add_column("organizations", sa.Column("city", sa.String(120), nullable=True))
    op.add_column("organizations", sa.Column("province", sa.String(120), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("address_public", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    conexion = op.get_bind()
    filas = conexion.execute(
        sa.text("SELECT organization_id, social_links FROM organization_branding")
    ).all()
    for organization_id, enlaces in filas:
        nuevas = normalizar(list(enlaces or []))
        if nuevas != (enlaces or []):
            conexion.execute(
                sa.text(
                    "UPDATE organization_branding SET social_links = CAST(:enlaces AS jsonb) "
                    "WHERE organization_id = :id"
                ),
                {"enlaces": json.dumps(nuevas), "id": organization_id},
            )


def downgrade() -> None:
    # Las redes normalizadas siguen siendo válidas con el tipo libre de antes.
    for columna in ("address_public", "province", "city", "postal_code"):
        op.drop_column("organizations", columna)
