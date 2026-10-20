"""recordatorio a los inscritos y cierre de asistencia

Cada evento decide si envía un recordatorio a sus inscritos confirmados y con
cuántas horas de antelación (conjunto cerrado: 2, 6, 12, 24, 48 o 72), y guarda
cuándo cerró el organizador la asistencia (solo los eventos cerrados cuentan
ausencias). Cada inscripción guarda la reclamación y el envío de su
recordatorio, y para qué fecha del evento se envió: si la fecha cambia, vuelve
a ser elegible.

Eventos existentes: activados a 24 h (48 h los de pago), salvo los que empiezan
en las 72 h siguientes a esta migración, que quedan desactivados para no lanzar
una ráfaga de correos nada más desplegar.

Revision ID: 0064_recordatorio_y_ausencias
Revises: 0063_tipos_de_sesion
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0064_recordatorio_y_ausencias"
down_revision: str | None = "0063_tipos_de_sesion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("reminder_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "events",
        sa.Column("reminder_hours_before", sa.Integer(), nullable=False, server_default="24"),
    )
    op.add_column("events", sa.Column("attendance_closed_at", _TS, nullable=True))
    op.create_check_constraint(
        "ck_events_reminder_hours_before",
        "events",
        "reminder_hours_before IN (2, 6, 12, 24, 48, 72)",
    )
    for columna in ("reminder_claimed_at", "reminder_sent_at", "reminder_sent_for_starts_at"):
        op.add_column("event_registrations", sa.Column(columna, _TS, nullable=True))
    # Historial de ausencias: las inscripciones confirmadas de una persona en
    # su organización (el correo ya se guarda en minúsculas).
    op.create_index(
        "ix_event_registrations_org_email_confirmadas",
        "event_registrations",
        ["organization_id", "email"],
        postgresql_where=sa.text("status = 'confirmed'"),
    )

    op.execute("UPDATE events SET reminder_hours_before = 48 WHERE registration_mode = 'paid'")
    op.execute(
        "UPDATE events SET reminder_enabled = false "
        "WHERE starts_at > now() AND starts_at <= now() + interval '72 hours'"
    )


def downgrade() -> None:
    op.drop_index("ix_event_registrations_org_email_confirmadas", table_name="event_registrations")
    for columna in ("reminder_sent_for_starts_at", "reminder_sent_at", "reminder_claimed_at"):
        op.drop_column("event_registrations", columna)
    op.drop_constraint("ck_events_reminder_hours_before", "events", type_="check")
    for columna in ("attendance_closed_at", "reminder_hours_before", "reminder_enabled"):
        op.drop_column("events", columna)
