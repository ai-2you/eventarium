"""Historial de ausencias de una persona en su organización.

No se guarda: se calcula al consultarlo, así que corregir un check-in o
reabrir la asistencia de un evento se refleja al momento. Una inscripción
cuenta como ausencia solo si se cumple todo esto:

- estaba confirmada antes de que empezara el evento y recibió el recordatorio
  (cada ausencia contada tuvo su aviso);
- el correo estaba verificado o había un pago: nadie puede apuntar ausencias
  a otra persona inscribiéndola con su correo;
- el evento es presencial, no está borrado ni cancelado, ya terminó, el
  organizador cerró su asistencia y terminó en los últimos 12 meses;
- su entrada existe, no está revocada y no se escaneó.

Siempre en la sesión de la petición (RLS) y además filtrando por
`organization_id`: nunca cruza organizaciones.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_AUSENCIAS = """
    FROM event_registrations r
    JOIN events e ON e.id = r.event_id AND e.organization_id = r.organization_id
    JOIN event_tickets t ON t.registration_id = r.id AND t.organization_id = r.organization_id
    WHERE r.organization_id = :organization_id
      AND r.status = 'confirmed'
      AND r.confirmed_at < e.starts_at
      AND r.reminder_sent_at IS NOT NULL
      AND (
          r.verified_at IS NOT NULL
          OR EXISTS (
              SELECT 1 FROM event_payments p
              WHERE p.registration_id = r.id
                AND p.organization_id = r.organization_id
                AND p.status IN ('paid', 'partially_refunded')
          )
      )
      AND e.location_mode = 'in_person'
      AND e.deleted_at IS NULL
      AND e.status <> 'cancelled'
      AND e.attendance_closed_at IS NOT NULL
      AND e.ends_at < now()
      AND e.ends_at > now() - interval '12 months'
      AND t.revoked_at IS NULL
      AND t.used_at IS NULL
"""


_POR_CORREO = text(
    f"SELECT r.email, count(*) {_AUSENCIAS} AND r.email = ANY(:correos) GROUP BY r.email"  # noqa: S608 — SQL fijo
)
_DE_UNA_PERSONA = text(
    f"SELECT e.title, e.starts_at {_AUSENCIAS} AND r.email = :correo "  # noqa: S608 — SQL fijo
    "ORDER BY e.starts_at DESC LIMIT 50"
)


@dataclass(frozen=True, slots=True)
class Ausencia:
    event_title: str
    starts_at: datetime


async def contar_por_correo(
    session: AsyncSession, organization_id: uuid.UUID, correos: list[str]
) -> dict[str, int]:
    """Ausencias de cada correo de una página del listado, en una sola consulta.
    Si falla, el listado sigue sin la etiqueta."""
    if not correos:
        return {}
    try:
        async with session.begin_nested():
            filas = await session.execute(
                _POR_CORREO,
                {"organization_id": organization_id, "correos": correos},
            )
            return {correo: total for correo, total in filas}
    except SQLAlchemyError:
        logger.exception("No se pudo calcular el historial de ausencias.")
        return {}


async def de_una_persona(
    session: AsyncSession, organization_id: uuid.UUID, correo: str
) -> list[Ausencia]:
    try:
        async with session.begin_nested():
            filas = await session.execute(
                _DE_UNA_PERSONA,
                {"organization_id": organization_id, "correo": correo},
            )
            return [Ausencia(event_title=titulo, starts_at=inicio) for titulo, inicio in filas]
    except SQLAlchemyError:
        logger.exception("No se pudo calcular el historial de ausencias.")
        return []
