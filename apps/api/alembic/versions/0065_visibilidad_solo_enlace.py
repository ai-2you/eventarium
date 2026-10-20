"""eventos «solo con enlace»

Un evento `hidden` se abre por su URL (ficha, inscripción, compra, sesiones,
patrocinadores y políticas) aunque no aparezca en ningún listado. Solo cambian
las dos funciones que resuelven un evento público por su slug; la que lista las
organizaciones con eventos de la portada (`app_list_public_event_organizations`)
sigue exigiendo `public`, así que una organización con solo eventos ocultos no
aparece. `private` sigue sin abrirse.

Revision ID: 0065_visibilidad_solo_enlace
Revises: 0064_recordatorio_y_ausencias
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0065_visibilidad_solo_enlace"
down_revision: str | None = "0064_recordatorio_y_ausencias"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _funciones(visibilidad: str) -> tuple[str, ...]:
    """Las dos funciones de resolución, como en `0060`, con otro filtro de visibilidad."""
    return tuple(
        f"""
CREATE OR REPLACE FUNCTION {nombre}(p_org_slug text, p_slug text)
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.organization_id
  FROM events e
  JOIN organizations o ON o.id = e.organization_id
  WHERE o.slug = p_org_slug
    AND e.slug = p_slug
    AND e.status {estados}
    AND {visibilidad}
    AND o.is_active
    AND e.deleted_at IS NULL
$$
        """
        for nombre, estados in (
            ("app_resolve_public_event", "= 'published'"),
            ("app_resolve_public_event_display", "IN ('published', 'cancelled')"),
        )
    )


def upgrade() -> None:
    for sentencia in _funciones("e.visibility IN ('public', 'hidden')"):
        op.execute(sentencia)


def downgrade() -> None:
    for sentencia in _funciones("e.visibility = 'public'"):
        op.execute(sentencia)
