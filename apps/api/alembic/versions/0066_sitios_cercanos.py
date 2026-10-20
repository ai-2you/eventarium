"""sitios cercanos a un evento

Alojamiento, restaurantes, parking y demás servicios que el organizador señala
cerca de cada evento, con RLS por organización como las sedes (`0017`).

Revision ID: 0066_sitios_cercanos
Revises: 0065_visibilidad_solo_enlace
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0066_sitios_cercanos"
down_revision: str | None = "0065_visibilidad_solo_enlace"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLA = "event_nearby_places"


def upgrade() -> None:
    op.create_table(
        _TABLA,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("custom_kind", sa.String(40), nullable=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("address", sa.String(300), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("notes", sa.String(300), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["event_id", "organization_id"],
            ["events.id", "events.organization_id"],
            name="fk_event_nearby_places_event_id_organization_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_event_nearby_places"),
        sa.UniqueConstraint(
            "id", "organization_id", name="uq_event_nearby_places_id_organization_id"
        ),
        sa.CheckConstraint(
            "kind IN ('hotel', 'restaurant', 'bar', 'parking', 'transport', 'pharmacy', 'other')",
            name="ck_event_nearby_places_kind",
        ),
        sa.CheckConstraint(
            "(kind = 'other') = (custom_kind IS NOT NULL)",
            name="ck_event_nearby_places_custom_kind",
        ),
    )
    op.create_index("ix_event_nearby_places_event_id", _TABLA, ["event_id"])

    concedido = (
        op.get_bind()
        .execute(
            sa.text("SELECT has_table_privilege('app_user', :tabla, 'SELECT')"), {"tabla": _TABLA}
        )
        .scalar()
    )
    if not concedido:
        raise RuntimeError(
            f"El rol «app_user» no tiene SELECT sobre «{_TABLA}». Ejecuta "
            "infra/scripts/ensure-roles.sh para aplicar ALTER DEFAULT PRIVILEGES."
        )

    op.execute(f"ALTER TABLE {_TABLA} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {_TABLA} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_{_TABLA} ON {_TABLA} "
        "USING (organization_id = app_current_organization()) "
        "WITH CHECK (organization_id = app_current_organization())"
    )


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS tenant_{_TABLA} ON {_TABLA}")
    op.drop_index("ix_event_nearby_places_event_id", table_name=_TABLA)
    op.drop_table(_TABLA)
