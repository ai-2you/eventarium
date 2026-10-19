"""«Mis eventos»: acceso por enlace mágico, sin cuenta, a las inscripciones de
un correo. Separado de `service.py`, que es el flujo de las inscripciones.
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tasks import (
    send_mis_eventos_access_email,
)
from app.modules.auth.verification import (
    PROPOSITO_MIS_EVENTOS_ACCESO,
    TTL_MIS_EVENTOS_ACCESO,
    consume_token,
    generate_token,
)
from app.modules.organizations.schemas import PublicOrganizationRef
from app.modules.registrations import repository
from app.modules.registrations.schemas import MyRegistrationItem
from app.shared.errors import ValidationDomainError

logger = logging.getLogger(__name__)

# Límite de longitud para una respuesta de texto libre: no hay columna que lo
# imponga (es `jsonb`), así que se acota aquí para no aceptar payloads enormes.


async def request_mis_eventos_access(session: AsyncSession, *, email: str) -> None:
    """Encola el magic-link de «Mis eventos» solo si el email tiene alguna
    inscripción. Respuesta anti-enumeración, mismo patrón que `forgot_password`.

    Hallazgo de red-team (Critical) sobre la primera redacción de este plan:
    mandar el enlace a cualquier email escrito en el formulario, exista o no
    una inscripción real, lo convertía en una herramienta de acoso por
    correo. El endpoint que llama a esta función sigue respondiendo 200
    siempre; el correo real solo sale de aquí.
    """
    email_normalizado = email.strip().lower()
    if await repository.has_registration_by_email(session, email_normalizado):
        token = await generate_token(
            PROPOSITO_MIS_EVENTOS_ACCESO, email_normalizado, ttl=TTL_MIS_EVENTOS_ACCESO
        )
        await send_mis_eventos_access_email.kiq(email_normalizado, token)


async def list_mis_eventos(session: AsyncSession, *, token: str) -> list[MyRegistrationItem]:
    """Consume el token del magic-link y devuelve las inscripciones del email.

    Token de un solo uso (`consume_token`, no `peek_token`): recargar la
    página exige pedir un enlace nuevo, trade-off de UX aceptado
    explícitamente en el plan (alcance ya cerrado a "sin sesión persistente").
    """
    email = await consume_token(PROPOSITO_MIS_EVENTOS_ACCESO, token)
    if email is None:
        raise ValidationDomainError("El enlace no es válido o ha caducado. Pide uno nuevo.")

    filas = await repository.list_registrations_by_email(session, email)
    return [
        MyRegistrationItem(
            event_slug=fila.event_slug,
            event_title=fila.event_title,
            starts_at=fila.starts_at,
            organization_name=fila.organization_name,
            organization=PublicOrganizationRef(
                slug=fila.organization_slug,
                name=fila.organization_name,
                page_public=fila.organization_page_public,
            ),
            status=fila.status,
            event_cancelled=fila.event_status == "cancelled",
        )
        for fila in filas
    ]
