"""Esquemas de los sitios cercanos: panel y ficha pública."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

NearbyKind = Literal["hotel", "restaurant", "bar", "parking", "transport", "pharmacy", "other"]
_TELEFONO = r"^\+?[0-9 ().-]{6,20}$"
_WEB = r"^https?://"


class _Campos(BaseModel):
    custom_kind: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    address: Annotated[str, Field(max_length=300)] | None = None
    phone: Annotated[str, Field(pattern=_TELEFONO)] | None = None
    website: Annotated[str, Field(max_length=500, pattern=_WEB)] | None = None
    notes: Annotated[str, Field(max_length=300)] | None = None


class NearbyPlaceCreate(_Campos):
    kind: NearbyKind
    name: Annotated[str, Field(min_length=1, max_length=160)]

    @model_validator(mode="after")
    def _tipo_libre_solo_con_otro(self) -> NearbyPlaceCreate:
        if (self.kind == "other") != bool(self.custom_kind and self.custom_kind.strip()):
            raise ValueError("Indica el tipo con nombre libre solo cuando el tipo es «Otro».")
        return self


class NearbyPlaceUpdate(_Campos):
    kind: NearbyKind | None = None
    name: Annotated[str, Field(min_length=1, max_length=160)] | None = None


class NearbyPlaceOrder(BaseModel):
    ids: list[str]


class NearbyPlaceResponse(BaseModel):
    id: str
    kind: NearbyKind
    custom_kind: str | None
    name: str
    address: str | None
    phone: str | None
    website: str | None
    notes: str | None
    display_order: int
    updated_at: datetime


class PublicNearbyPlace(BaseModel):
    """Lo que ve el público: sin auditoría ni orden interno."""

    kind: NearbyKind
    custom_kind: str | None
    name: str
    address: str | None
    phone: str | None
    website: str | None
    notes: str | None
