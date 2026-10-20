"""«Mis eventos»: datos para añadir cada evento al calendario

El listado de «Mis eventos» ofrece «Añadir a mi calendario» con la misma regla
que el resto de respuestas públicas (`registrations/calendar.py`): necesita el
fin, la zona horaria, el lugar y el enlace de conexión del evento.
`app_list_registrations_by_email` los devuelve además de lo que ya tenía.

Añadir columnas cambia el tipo de retorno, así que no basta `CREATE OR REPLACE`:
se borra y se crea de nuevo. Una función recién creada concede `EXECUTE` a
`PUBLIC`, y esta es `SECURITY DEFINER` y lista datos personales por correo:
se retira ese permiso y solo se concede a `app_user`, igual que en `0059`. El
`downgrade` restablece la definición de `0060`, con el filtro de eliminados.

Revision ID: 0068_mis_eventos_calendario
Revises: 0067_direccion_y_redes_org
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0068_mis_eventos_calendario"
down_revision: str | None = "0067_direccion_y_redes_org"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOMBRE = "app_list_registrations_by_email(text)"

_FUNCION = """
CREATE FUNCTION app_list_registrations_by_email(p_email text)
RETURNS TABLE (
  event_slug text,
  event_title text,
  starts_at timestamptz,
  organization_name text,
  status text,
  event_status text,
  organization_slug text,
  organization_page_public boolean{extra_columnas}
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.slug, e.title, e.starts_at, o.name, r.status, e.status, o.slug,
    o.public_page_enabled{extra_select}
  FROM event_registrations r
  JOIN events e ON e.id = r.event_id
  JOIN organizations o ON o.id = r.organization_id
  WHERE r.email = p_email AND o.is_active
    AND e.deleted_at IS NULL
  ORDER BY e.starts_at ASC
$$
"""

_COLUMNAS_CALENDARIO = """,
  ends_at timestamptz,
  timezone text,
  location_name text,
  location_address text,
  online_url text"""

_SELECT_CALENDARIO = (
    ",\n    e.ends_at, e.timezone, e.location_name, e.location_address, e.online_url"
)


def _recrear(*, con_calendario: bool) -> None:
    op.execute(f"DROP FUNCTION IF EXISTS {_NOMBRE}")
    op.execute(
        _FUNCION.format(
            extra_columnas=_COLUMNAS_CALENDARIO if con_calendario else "",
            extra_select=_SELECT_CALENDARIO if con_calendario else "",
        )
    )
    op.execute(f"REVOKE ALL ON FUNCTION {_NOMBRE} FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION {_NOMBRE} TO app_user")


def upgrade() -> None:
    _recrear(con_calendario=True)


def downgrade() -> None:
    _recrear(con_calendario=False)
