"""«Mis eventos» con la sesión iniciada: el listado sale del correo de la
cuenta, sin enlace mágico, y solo si ese correo está verificado.

Reutiliza los ayudantes de `test_registrations_mis_eventos.py`: mismo cliente
HTTP real y las mismas inscripciones creadas a mano.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from app.core.security import create_access_token
from app.modules.auth.verification import PROPOSITO_MIS_EVENTOS_ACCESO, generate_token
from tests.conftest import OrganizacionDePrueba, iniciar_sesion
from tests.modules.test_registrations_mis_eventos import (
    VER,
    _crear_inscripcion,
    _crear_y_publicar_evento,
)

MIOS = "/api/v1/public/mis-eventos/mios"
# Fechas holgadas: el test no depende de en qué minuto se ejecute.
MANANA = datetime.now(UTC).replace(microsecond=0) + timedelta(days=1)


async def _verificar_correo(organizacion: OrganizacionDePrueba) -> None:
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE users SET email_verified_at = now() WHERE id = :id"),
            {"id": organizacion.owner_id},
        )
        await session.commit()


async def _evento(cliente: AsyncClient, cabeceras: dict[str, str], slug: str) -> dict:
    return await _crear_y_publicar_evento(
        cliente,
        cabeceras,
        slug,
        starts_at=MANANA.isoformat(),
        ends_at=(MANANA + timedelta(hours=3)).isoformat(),
        timezone="Europe/Madrid",
        location_name="Sala Norte",
        location_address="Calle Mayor 1, Madrid",
    )


class TestMisEventosConSesion:
    async def test_sin_token_responde_401(self, cliente: AsyncClient) -> None:
        respuesta = await cliente.get(MIOS)

        assert respuesta.status_code == 401, respuesta.text

    async def test_correo_sin_verificar_responde_403(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        """Sin esta comprobación, cualquiera crearía una cuenta con el correo de
        otra persona y vería sus inscripciones."""
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _evento(cliente, cabeceras, "mios-sin-verificar")
        await _crear_inscripcion(organizacion, evento, email=organizacion.owner_email)

        respuesta = await cliente.get(MIOS, headers=cabeceras)

        assert respuesta.status_code == 403, respuesta.text

    async def test_correo_verificado_lista_sus_inscripciones_con_calendario(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _evento(cliente, cabeceras, "mios-verificado")
        await _crear_inscripcion(organizacion, evento, email=organizacion.owner_email)
        otro = await _evento(cliente, cabeceras, "mios-de-otra-persona")
        await _crear_inscripcion(organizacion, otro, email="otra@example.com")
        await _verificar_correo(organizacion)

        respuesta = await cliente.get(MIOS, headers=cabeceras)

        assert respuesta.status_code == 200, respuesta.text
        filas = respuesta.json()["registrations"]
        assert [f["event_slug"] for f in filas] == ["mios-verificado"]
        fila = filas[0]
        assert fila["timezone"] == "Europe/Madrid"
        assert fila["ends_at"] is not None
        assert fila["calendar"]["location"] == "Sala Norte, Calle Mayor 1, Madrid"
        assert fila["calendar"]["organization"]["slug"] == organizacion.slug

    async def test_lista_de_espera_no_ofrece_calendario(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        """Misma regla que el resto de respuestas públicas: sin plaza
        confirmada no se propone poner el evento en el calendario."""
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _evento(cliente, cabeceras, "mios-en-espera")
        await _crear_inscripcion(
            organizacion, evento, email=organizacion.owner_email, status="waitlisted"
        )
        await _verificar_correo(organizacion)

        respuesta = await cliente.get(MIOS, headers=cabeceras)

        assert respuesta.status_code == 200, respuesta.text
        (fila,) = respuesta.json()["registrations"]
        assert fila["status"] == "waitlisted"
        assert fila["calendar"] is None

    async def test_durante_una_suplantacion_responde_403(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        """El personal de plataforma no debe ver las inscripciones personales
        de quien suplanta, aunque el correo esté verificado."""
        await _verificar_correo(organizacion)
        token = create_access_token(
            organizacion.owner_id, organizacion.id, impersonated_by=uuid.uuid4()
        )

        with patch(
            "app.modules.admin.impersonation.sesion_activa", new=AsyncMock(return_value=True)
        ):
            respuesta = await cliente.get(MIOS, headers={"Authorization": f"Bearer {token}"})

        assert respuesta.status_code == 403, respuesta.text

    async def test_misma_salida_que_el_enlace_del_correo(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _evento(cliente, cabeceras, "mios-igual-que-enlace")
        await _crear_inscripcion(organizacion, evento, email=organizacion.owner_email)
        await _verificar_correo(organizacion)
        token = await generate_token(PROPOSITO_MIS_EVENTOS_ACCESO, organizacion.owner_email)

        con_sesion = await cliente.get(MIOS, headers=cabeceras)
        con_enlace = await cliente.post(VER, json={"token": token})

        assert con_sesion.status_code == 200, con_sesion.text
        assert con_enlace.status_code == 200, con_enlace.text
        assert con_sesion.json() == con_enlace.json()


class TestPermisosDeLaFuncion:
    async def test_public_no_puede_ejecutar_la_funcion(self) -> None:
        """Es `SECURITY DEFINER` y lista datos personales por correo: al
        recrearla hay que retirar el `EXECUTE` que se concede a `PUBLIC`."""
        async with SessionMaintenance() as session:
            permisos = (
                (
                    await session.execute(
                        text(
                            "SELECT has_function_privilege(rol, "
                            "'app_list_registrations_by_email(text)', 'EXECUTE') "
                            "FROM unnest(ARRAY['public', 'app_user']) AS rol"
                        )
                    )
                )
                .scalars()
                .all()
            )

        assert permisos == [False, True]
