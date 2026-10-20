"""Tipos de sesión por organización: paleta, tipos base y resolución.

Cada organización nace con los tipos base (`TIPOS_BASE`) que puede renombrar,
desactivar o ampliar. `base_key` empareja el texto heredado de
`event_sessions.session_type` y los alias del MCP aunque el nombre cambie.
"""

from __future__ import annotations

import uuid
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.events.models import SessionType

#: Colores permitidos (claves que el frontend traduce a tokens con contraste AA
#: en tema claro y oscuro). Un color libre no garantizaría que se lea.
PALETA = ("azul", "violeta", "verde", "ambar", "rosa", "cian", "rojo", "gris")

#: Clave base para lo que no encaja en ninguna otra.
BASE_POR_DEFECTO = "other"


class TipoBase(NamedTuple):
    base_key: str
    name: str
    color: str
    is_break: bool


TIPOS_BASE: tuple[TipoBase, ...] = (
    TipoBase("talk", "Charla", "azul", False),
    TipoBase("workshop", "Taller", "violeta", False),
    TipoBase("break", "Descanso", "gris", True),
    TipoBase("service", "Servicio", "ambar", True),
    TipoBase("other", "Otro", "cian", False),
)

CLAVES_BASE = frozenset(tipo.base_key for tipo in TIPOS_BASE)


async def crear_tipos_base(session: AsyncSession, organization_id: uuid.UUID) -> None:
    """Los tipos con los que nace una organización (las dos altas lo llaman)."""
    for orden, tipo in enumerate(TIPOS_BASE):
        session.add(
            SessionType(
                organization_id=organization_id,
                name=tipo.name,
                color=tipo.color,
                is_break=tipo.is_break,
                base_key=tipo.base_key,
                display_order=orden,
            )
        )
    await session.flush()


async def tipo_por_clave_base(
    session: AsyncSession, organization_id: uuid.UUID, clave: str
) -> SessionType | None:
    """El tipo de la organización para una clave heredada (`talk`, `break`…);
    una clave desconocida cae en «Otro». `None` si la organización no tiene
    tipos (no debería: las dos altas los crean)."""
    buscada = clave if clave in CLAVES_BASE else BASE_POR_DEFECTO
    tipo: SessionType | None = await session.scalar(
        select(SessionType).where(
            SessionType.organization_id == organization_id,
            SessionType.base_key == buscada,
        )
    )
    return tipo
