"""Sitios cercanos de un evento, con RLS por organización como las sedes."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TimestampMixin
from app.shared.identifiers import new_uuid7

TIPOS = ("hotel", "restaurant", "bar", "parking", "transport", "pharmacy", "other")


class EventNearbyPlace(Base, TimestampMixin):
    """Un sitio cerca del evento que el organizador recomienda o señala."""

    __tablename__ = "event_nearby_places"
    __table_args__ = (
        ForeignKeyConstraint(
            ["event_id", "organization_id"],
            ["events.id", "events.organization_id"],
            name="fk_event_nearby_places_event_id_organization_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "organization_id", name="uq_event_nearby_places_id_organization_id"),
        CheckConstraint(
            "kind IN ('hotel', 'restaurant', 'bar', 'parking', 'transport', 'pharmacy', 'other')",
            name="ck_event_nearby_places_kind",
        ),
        CheckConstraint(
            "(kind = 'other') = (custom_kind IS NOT NULL)",
            name="ck_event_nearby_places_custom_kind",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=new_uuid7)
    event_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Solo con `kind == "other"`: el tipo con nombre libre («Gimnasio», «Museo»…).
    custom_kind: Mapped[str | None] = mapped_column(String(40), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
