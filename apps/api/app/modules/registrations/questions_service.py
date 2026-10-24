"""Preguntas del formulario de inscripción de un evento (panel de organizador).

Separado de `service.py`, que es el flujo de las inscripciones en sí.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.registrations import repository
from app.modules.registrations.models import (
    EventRegistrationQuestion,
)
from app.shared.errors import ConflictError, NotFoundError, ValidationDomainError

logger = logging.getLogger(__name__)

# Límite de longitud para una respuesta de texto libre: no hay columna que lo
# imponga (es `jsonb`), así que se acota aquí para no aceptar payloads enormes.


def _validar_options_por_tipo(type_: str, options: list[str] | None) -> list[str] | None:
    if type_ == "short_text":
        if options:
            raise ValidationDomainError("Una pregunta de texto libre no lleva opciones.")
        return None
    if not options:
        raise ValidationDomainError("Una pregunta de opción necesita al menos una opción.")
    return options


async def create_registration_question(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    event_id: uuid.UUID,
    type_: str,
    label: str,
    required: bool,
    sort_order: int,
    options: list[str] | None,
) -> EventRegistrationQuestion:
    """Añadir una pregunta nueva siempre está permitido, tenga o no ya
    inscripciones el evento — la restricción de la decisión #6 solo aplica a
    editar o borrar una pregunta con respuestas asociadas."""
    pregunta = EventRegistrationQuestion(
        event_id=event_id,
        organization_id=organization_id,
        type=type_,
        label=label.strip(),
        required=required,
        sort_order=sort_order,
        options=_validar_options_por_tipo(type_, options),
    )
    session.add(pregunta)
    await session.flush()
    return pregunta


async def update_registration_question(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    event_id: uuid.UUID,
    question_id: uuid.UUID,
    datos: dict[str, Any],
) -> EventRegistrationQuestion:
    """`label`/`required`/`sort_order` siempre se pueden editar; `type`/`options`
    solo si la pregunta no tiene respuestas asociadas (409 si las tiene) —
    decisión #6 del PRD: no dejar respuestas huérfanas o de un tipo distinto
    al declarado."""
    pregunta = await repository.get_question(session, organization_id, event_id, question_id)
    if pregunta is None:
        raise NotFoundError("La pregunta no existe.")

    cambia_forma = "type" in datos or "options" in datos
    if cambia_forma and await repository.question_has_answers(
        session, organization_id, pregunta.id
    ):
        raise ConflictError(
            "No se puede cambiar el tipo ni las opciones de una pregunta con respuestas guardadas."
        )

    nuevo_tipo = datos.get("type", pregunta.type)
    if "type" in datos or "options" in datos:
        pregunta.options = _validar_options_por_tipo(
            nuevo_tipo, datos.get("options", pregunta.options)
        )
        pregunta.type = nuevo_tipo
    if "label" in datos:
        pregunta.label = datos["label"].strip()
    if "required" in datos:
        pregunta.required = datos["required"]
    if "sort_order" in datos:
        pregunta.sort_order = datos["sort_order"]
    return pregunta


async def delete_registration_question(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    event_id: uuid.UUID,
    question_id: uuid.UUID,
) -> None:
    pregunta = await repository.get_question(session, organization_id, event_id, question_id)
    if pregunta is None:
        raise NotFoundError("La pregunta no existe.")
    if await repository.question_has_answers(session, organization_id, pregunta.id):
        raise ConflictError("No se puede borrar una pregunta con respuestas guardadas.")
    await session.delete(pregunta)
