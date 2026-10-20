"""Cierre de la asistencia de un evento.

Tras el evento, el organizador declara que la asistencia está completa: solo
entonces cuentan las ausencias (un check-in a medias o un escaneo de prueba no
marca a nadie). Se puede reabrir durante 7 días para corregir escaneos
olvidados.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.modules.events.models import Event
from app.shared.errors import ConflictError

PLAZO_PARA_REABRIR = timedelta(days=7)


def cerrar(evento: Event) -> None:
    if datetime.now(UTC) < evento.ends_at:
        raise ConflictError("La asistencia se cierra cuando el evento ha terminado.")
    if evento.attendance_closed_at is None:
        evento.attendance_closed_at = datetime.now(UTC)


def reabrir(evento: Event) -> None:
    if evento.attendance_closed_at is None:
        raise ConflictError("La asistencia de este evento no está cerrada.")
    if datetime.now(UTC) > evento.attendance_closed_at + PLAZO_PARA_REABRIR:
        raise ConflictError("Ya no se puede reabrir: han pasado más de 7 días desde el cierre.")
    evento.attendance_closed_at = None
