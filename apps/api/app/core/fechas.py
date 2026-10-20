"""Fechas y horas en la zona horaria de cada evento, para los correos.

Los instantes se guardan en UTC; a la persona hay que darle la hora de su
evento. Una zona que `zoneinfo` no conoce (datos antiguos, anteriores a la
validación) no rompe el envío: se usa la zona por defecto y se registra.
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

ZONA_POR_DEFECTO = "Europe/Madrid"


def zona(nombre: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(nombre or ZONA_POR_DEFECTO)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning("Zona horaria desconocida %r: se usa %s.", nombre, ZONA_POR_DEFECTO)
        return ZoneInfo(ZONA_POR_DEFECTO)


def fecha_y_hora(instante: datetime, nombre_zona: str | None) -> str:
    """«21/10/2026 18:00», en la zona del evento."""
    return instante.astimezone(zona(nombre_zona)).strftime("%d/%m/%Y %H:%M")
