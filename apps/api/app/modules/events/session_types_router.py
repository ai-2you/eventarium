"""Tipos de sesión de la organización actual (`/organizations/me/session-types`).

Mismo prefijo que los niveles de patrocinio: la organización sale del usuario
autenticado, nunca de un `{id}` en la ruta. Leer con `events:read` (el
formulario de sesión los necesita); gestionar con `events:write`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from app.core.deps import CurrentUserDep, DbDep, require_permission
from app.core.permissions import Permission
from app.modules.events import session_types
from app.modules.events.models import SessionType
from app.modules.events.schemas import (
    SessionTypeCreate,
    SessionTypeOrder,
    SessionTypeOut,
    SessionTypeUpdate,
)
from app.shared.errors import NotFoundError, ValidationDomainError

router = APIRouter(prefix="/organizations/me/session-types", tags=["eventos"])


def _salida(tipo: SessionType, sesiones: int) -> SessionTypeOut:
    return SessionTypeOut(
        **session_types.referencia(tipo),
        description=tipo.description,
        base_key=tipo.base_key,
        display_order=tipo.display_order,
        is_active=tipo.is_active,
        sesiones=sesiones,
    )


def _id(valor: str) -> uuid.UUID:
    try:
        return uuid.UUID(valor)
    except ValueError as exc:
        raise NotFoundError("Ese tipo de sesión no existe.") from exc


async def _con_usos(
    session: DbDep, organization_id: uuid.UUID, tipo: SessionType
) -> SessionTypeOut:
    for candidato, usos in await session_types.listar(session, organization_id):
        if candidato.id == tipo.id:
            return _salida(candidato, usos)
    return _salida(tipo, 0)


@router.get(
    "",
    summary="Listar los tipos de sesión de la organización",
    response_model=list[SessionTypeOut],
    dependencies=[require_permission(Permission.EVENTS_READ)],
)
async def list_session_types(
    usuario: CurrentUserDep, session: DbDep, activos: bool = False
) -> list[SessionTypeOut]:
    filas = await session_types.listar(session, usuario.organization_id, solo_activos=activos)
    return [_salida(tipo, usos) for tipo, usos in filas]


@router.post(
    "",
    summary="Crear un tipo de sesión",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionTypeOut,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def create_session_type(
    datos: SessionTypeCreate, usuario: CurrentUserDep, session: DbDep
) -> SessionTypeOut:
    tipo = await session_types.crear(session, usuario.organization_id, datos.model_dump())
    return _salida(tipo, 0)


@router.put(
    "/order",
    summary="Reordenar los tipos de sesión",
    description="Recibe **todos** los tipos en el orden nuevo; si cambiaron entretanto, 409.",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def reorder_session_types(
    datos: SessionTypeOrder, usuario: CurrentUserDep, session: DbDep
) -> None:
    try:
        ids = [uuid.UUID(valor) for valor in datos.ids]
    except ValueError as exc:
        raise ValidationDomainError("Algún identificador de tipo no es válido.") from exc
    await session_types.reordenar(session, usuario.organization_id, ids)


@router.patch(
    "/{tipo_id}",
    summary="Editar un tipo de sesión",
    response_model=SessionTypeOut,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def update_session_type(
    tipo_id: str, datos: SessionTypeUpdate, usuario: CurrentUserDep, session: DbDep
) -> SessionTypeOut:
    tipo = await session_types.actualizar(
        session, usuario.organization_id, _id(tipo_id), datos.model_dump(exclude_unset=True)
    )
    return await _con_usos(session, usuario.organization_id, tipo)


@router.delete(
    "/{tipo_id}",
    summary="Borrar un tipo de sesión que no se usa",
    description="Con sesiones que lo usan responde 409: hay que desactivarlo.",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def delete_session_type(tipo_id: str, usuario: CurrentUserDep, session: DbDep) -> None:
    await session_types.borrar(session, usuario.organization_id, _id(tipo_id))
