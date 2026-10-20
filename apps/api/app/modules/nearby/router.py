"""Sitios cercanos de un evento en el panel (`/events/{event_id}/nearby-places`)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentUserDep, DbDep, require_permission
from app.core.permissions import Permission
from app.modules.events import repository as events_repository
from app.modules.events.models import Event
from app.modules.nearby import service
from app.modules.nearby.models import EventNearbyPlace
from app.modules.nearby.schemas import (
    NearbyPlaceCreate,
    NearbyPlaceOrder,
    NearbyPlaceResponse,
    NearbyPlaceUpdate,
)
from app.shared.errors import NotFoundError

router = APIRouter(prefix="/events/{event_id}/nearby-places", tags=["sitios cercanos"])


def _uuid_o_404(valor: str) -> uuid.UUID:
    try:
        return uuid.UUID(valor)
    except ValueError as exc:
        raise NotFoundError("No existe.") from exc


async def _obtener_evento_o_404(session: DbDep, usuario: CurrentUserDep, event_id: str) -> Event:
    evento = await events_repository.get_event(
        session, usuario.organization_id, _uuid_o_404(event_id)
    )
    if evento is None:
        raise NotFoundError("El evento no existe.")
    return evento


EventoDep = Annotated[Event, Depends(_obtener_evento_o_404)]


def _respuesta(sitio: EventNearbyPlace) -> NearbyPlaceResponse:
    return NearbyPlaceResponse(
        id=str(sitio.id),
        kind=sitio.kind,  # type: ignore[arg-type]
        custom_kind=sitio.custom_kind,
        name=sitio.name,
        address=sitio.address,
        phone=sitio.phone,
        website=sitio.website,
        notes=sitio.notes,
        display_order=sitio.display_order,
        updated_at=sitio.updated_at,
    )


@router.get(
    "",
    summary="Listar los sitios cercanos de un evento",
    response_model=list[NearbyPlaceResponse],
    dependencies=[require_permission(Permission.EVENTS_READ)],
)
async def list_nearby_places(evento: EventoDep, session: DbDep) -> list[NearbyPlaceResponse]:
    return [
        _respuesta(sitio)
        for sitio in await service.listar(session, evento.organization_id, evento.id)
    ]


@router.post(
    "",
    summary="Añadir un sitio cercano",
    status_code=status.HTTP_201_CREATED,
    response_model=NearbyPlaceResponse,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def create_nearby_place(
    datos: NearbyPlaceCreate, evento: EventoDep, session: DbDep
) -> NearbyPlaceResponse:
    sitio = await service.crear(
        session,
        organization_id=evento.organization_id,
        event_id=evento.id,
        datos=datos.model_dump(),
    )
    return _respuesta(sitio)


@router.put(
    "/order",
    summary="Reordenar los sitios cercanos",
    response_model=list[NearbyPlaceResponse],
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def order_nearby_places(
    datos: NearbyPlaceOrder, evento: EventoDep, session: DbDep
) -> list[NearbyPlaceResponse]:
    sitios = await service.reordenar(
        session, organization_id=evento.organization_id, event_id=evento.id, ids=datos.ids
    )
    return [_respuesta(sitio) for sitio in sitios]


@router.post(
    "/copy-from/{source_event_id}",
    summary="Copiar los sitios cercanos de otro evento",
    description="Añade al final copias de los sitios de otro evento de la misma organización.",
    response_model=list[NearbyPlaceResponse],
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def copy_nearby_places(
    source_event_id: str, evento: EventoDep, session: DbDep
) -> list[NearbyPlaceResponse]:
    sitios = await service.copiar_de_otro_evento(
        session,
        organization_id=evento.organization_id,
        event_id=evento.id,
        origen_id=_uuid_o_404(source_event_id),
    )
    return [_respuesta(sitio) for sitio in sitios]


@router.patch(
    "/{place_id}",
    summary="Editar un sitio cercano",
    response_model=NearbyPlaceResponse,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def update_nearby_place(
    place_id: str, datos: NearbyPlaceUpdate, evento: EventoDep, session: DbDep
) -> NearbyPlaceResponse:
    sitio = await service.actualizar(
        session,
        organization_id=evento.organization_id,
        event_id=evento.id,
        place_id=_uuid_o_404(place_id),
        datos=datos.model_dump(exclude_unset=True),
    )
    return _respuesta(sitio)


@router.delete(
    "/{place_id}",
    summary="Quitar un sitio cercano",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_permission(Permission.EVENTS_WRITE)],
)
async def delete_nearby_place(place_id: str, evento: EventoDep, session: DbDep) -> None:
    await service.borrar(
        session,
        organization_id=evento.organization_id,
        event_id=evento.id,
        place_id=_uuid_o_404(place_id),
    )
