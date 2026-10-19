"""Tareas que solo deben salir si la transacción llega a confirmarse.

Encolar un correo con `.kiq(...)` dentro de la transacción lo manda a Redis
al momento: si después la petición falla y se revierte, el correo ya ha
salido hablando de algo que no existe (p. ej. una compra que se rechaza por un
código de descuento caducado después de haber creado la inscripción).

`encolar_tras_commit` apunta la acción en la propia sesión y
`despachar_tras_commit` la ejecuta justo después de un commit efectivo. Lo
llaman los puntos donde se confirma una transacción: la dependencia de sesión
de las peticiones (`core/deps.py`), `maintenance_session` (webhooks y crons) y
las transacciones que un servicio abre por su cuenta. Si la transacción se
revierte, la sesión se cierra con la cola sin despachar y nada sale.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_CLAVE = "tras_commit"

Accion = Callable[[], Awaitable[object]]


def encolar_tras_commit(session: AsyncSession, accion: Accion) -> None:
    """Apunta `accion` para cuando la transacción de `session` se confirme."""
    session.info.setdefault(_CLAVE, []).append(accion)


def descartar_tras_commit(session: AsyncSession) -> None:
    """Olvida lo apuntado: lo que se va a confirmar ya no es lo que lo apuntó."""
    session.info.pop(_CLAVE, None)


async def despachar_tras_commit(session: AsyncSession) -> None:
    """Ejecuta lo apuntado, una sola vez. Un fallo al encolar no convierte en
    error una operación que ya se ha guardado: se registra y se sigue."""
    acciones: list[Accion] = session.info.pop(_CLAVE, [])
    for accion in acciones:
        try:
            await accion()
        except Exception:
            logger.exception("No se ha podido encolar una tarea tras el commit.")
