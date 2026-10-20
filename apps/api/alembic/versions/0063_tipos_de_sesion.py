"""tipos de sesión por organización

Cada organización tiene su catálogo de tipos de sesión (Charla, Taller,
Descanso…), con RLS como `sponsor_tiers`. Se crean los cinco base en cada
organización existente y cada sesión pasa a apuntar a su tipo por `base_key`
(`talk`, `workshop`, `break`, `service`; cualquier otro valor, a «Otro»).
`event_sessions.session_type` se conserva durante la transición.

Revision ID: 0063_tipos_de_sesion
Revises: 0062_sin_enlaces_antiguos
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PgUUID

from alembic import op

revision: str = "0063_tipos_de_sesion"
down_revision: str | None = "0062_sin_enlaces_antiguos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copia fija de `session_types.TIPOS_BASE` en el momento de esta migración: si
# el código cambia después, la migración debe seguir haciendo lo mismo.
_BASE = (
    ("talk", "Charla", "azul", False, 0),
    ("workshop", "Taller", "violeta", False, 1),
    ("break", "Descanso", "gris", True, 2),
    ("service", "Servicio", "ambar", True, 3),
    ("other", "Otro", "cian", False, 4),
)


def upgrade() -> None:
    op.create_table(
        "session_types",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True),
        sa.Column(
            "organization_id",
            PgUUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("description", sa.String(200), nullable=True),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("is_break", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("base_key", sa.String(20), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("id", "organization_id", name="uq_session_types_id_organization_id"),
    )
    op.create_index("ix_session_types_organization_id", "session_types", ["organization_id"])
    op.execute(
        "CREATE UNIQUE INDEX uq_session_types_organization_id_nombre "
        "ON session_types (organization_id, lower(btrim(name)))"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_session_types_organization_id_base_key "
        "ON session_types (organization_id, base_key) WHERE base_key IS NOT NULL"
    )
    op.execute("ALTER TABLE session_types ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE session_types FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_session_types ON session_types "
        "USING (organization_id = app_current_organization()) "
        "WITH CHECK (organization_id = app_current_organization())"
    )
    # Como las migraciones anteriores: si `ALTER DEFAULT PRIVILEGES` no se aplicó,
    # mejor fallar aquí que con un «permission denied» al dar de alta organizaciones.
    for privilegio in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        concedido = (
            op.get_bind()
            .execute(
                sa.text("SELECT has_table_privilege('app_user', 'session_types', :p)"),
                {"p": privilegio},
            )
            .scalar()
        )
        if not concedido:
            raise RuntimeError(
                f"El rol «app_user» no tiene {privilegio} sobre «session_types». Ejecuta "
                "infra/scripts/ensure-roles.sh para aplicar ALTER DEFAULT PRIVILEGES."
            )

    # Los cinco base en cada organización existente (la migración corre como
    # `app_maintainer`, con BYPASSRLS: no hace falta contexto de organización).
    valores = ", ".join(
        f"('{clave}', '{nombre}', '{color}', {str(pausa).lower()}, {orden})"
        for clave, nombre, color, pausa, orden in _BASE
    )
    op.execute(
        "INSERT INTO session_types "
        "(id, organization_id, name, color, is_break, base_key, display_order) "
        "SELECT gen_random_uuid(), o.id, b.nombre, b.color, b.pausa, b.clave, b.orden "
        f"FROM organizations o CROSS JOIN (VALUES {valores}) "
        "AS b(clave, nombre, color, pausa, orden)"
    )

    op.add_column(
        "event_sessions", sa.Column("session_type_id", PgUUID(as_uuid=True), nullable=True)
    )
    op.execute(
        "UPDATE event_sessions s SET session_type_id = t.id "
        "FROM session_types t "
        "WHERE t.organization_id = s.organization_id AND t.base_key = CASE "
        "WHEN s.session_type IN ('talk', 'workshop', 'break', 'service') THEN s.session_type "
        "ELSE 'other' END"
    )
    op.alter_column("event_sessions", "session_type_id", nullable=False)
    op.create_index("ix_event_sessions_session_type_id", "event_sessions", ["session_type_id"])
    op.create_foreign_key(
        "fk_event_sessions_session_type_id_organization_id",
        "event_sessions",
        "session_types",
        ["session_type_id", "organization_id"],
        ["id", "organization_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_event_sessions_session_type_id_organization_id", "event_sessions", type_="foreignkey"
    )
    op.drop_index("ix_event_sessions_session_type_id", table_name="event_sessions")
    op.drop_column("event_sessions", "session_type_id")
    op.execute("DROP POLICY IF EXISTS tenant_session_types ON session_types")
    op.drop_table("session_types")
