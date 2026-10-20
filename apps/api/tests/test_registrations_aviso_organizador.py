"""Aviso por correo al organizador de cada inscripción nueva, y correo de
«pendiente de aprobación» al participante.

Mismo patrón que `test_registrations_emails_and_cancellation.py`: cliente HTTP
real y las tareas de correo con `kiq` mockeado — se comprueba qué se encola, a
quién y cuándo, no la entrega.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core import tasks
from app.core.database import SessionMaintenance, maintenance_session
from app.core.deps import get_session
from app.core.email_template import neutralizar_texto_de_usuario
from app.core.tasks import (
    send_registration_confirmed_email,
    send_registration_pending_approval_email,
    send_registration_received_organizer_email,
    send_registration_verification_email,
    send_registration_waitlisted_email,
)
from app.core.tras_commit import encolar_tras_commit
from app.modules.auth.verification import generate_token
from tests.conftest import OrganizacionDePrueba, crear_miembro, iniciar_sesion
from tests.test_registrations_emails_and_cancellation import (
    _crear_y_publicar_evento,
    _inscribir,
    _registration_id,
)

EVENTS = "/api/v1/events"


@pytest.fixture(autouse=True)
def correos():
    parches = {
        nombre: patch.object(tarea, "kiq", new_callable=AsyncMock)
        for nombre, tarea in {
            "organizador": send_registration_received_organizer_email,
            "pendiente": send_registration_pending_approval_email,
            "confirmada": send_registration_confirmed_email,
            "lista_espera": send_registration_waitlisted_email,
            "verificacion": send_registration_verification_email,
        }.items()
    }
    mocks = {nombre: parche.start() for nombre, parche in parches.items()}
    yield mocks
    for parche in parches.values():
        parche.stop()


def _destinatarios(mock: AsyncMock) -> list[str]:
    return [llamada.kwargs["to_email"] for llamada in mock.await_args_list]


async def _verificar_cuentas() -> None:
    async with SessionMaintenance() as session:
        await session.execute(
            text("UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL")
        )
        await session.commit()


async def _verificar(cliente: AsyncClient, email: str) -> None:
    token = await generate_token("registration_email_verify", await _registration_id(email))
    respuesta = await cliente.post("/api/v1/public/registrations/verify", json={"token": token})
    assert respuesta.status_code == 200, respuesta.text


class TestAvisoAlOrganizador:
    async def test_una_inscripcion_nueva_avisa_a_quien_gestiona_inscripciones(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_y_publicar_evento(
            cliente, cabeceras, "aviso-libre", email_verification_required=False
        )
        organizador = await crear_miembro(organizacion, "organizer")
        await crear_miembro(organizacion, "speaker")
        await _verificar_cuentas()

        await _inscribir(cliente, "aviso-libre", full_name="Ana Pérez")

        assert sorted(_destinatarios(correos["organizador"])) == sorted(
            [organizacion.owner_email, organizador.email]
        )
        llamada = correos["organizador"].await_args_list[0]
        assert llamada.kwargs["event_id"] == evento["id"]
        assert llamada.kwargs["participant_name"] == "Ana Pérez"
        assert llamada.kwargs["status"] == "confirmed"

    async def test_con_aprobacion_avisa_que_esta_pendiente_y_responde_al_participante(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        await _crear_y_publicar_evento(
            cliente,
            cabeceras,
            "aviso-aprobacion",
            email_verification_required=False,
            registration_mode="approval",
        )

        await _verificar_cuentas()
        await _inscribir(cliente, "aviso-aprobacion")

        assert correos["organizador"].await_count == 1
        assert correos["organizador"].await_args.kwargs["status"] == "pending_approval"
        assert correos["pendiente"].await_count == 1
        assert correos["pendiente"].await_args.args[0] == "asistente@example.com"

    async def test_reenviar_el_formulario_pendiente_reenvia_al_participante_sin_avisar_otra_vez(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        await _crear_y_publicar_evento(
            cliente,
            cabeceras,
            "aviso-reenvio",
            email_verification_required=False,
            registration_mode="approval",
        )

        await _verificar_cuentas()
        await _inscribir(cliente, "aviso-reenvio")
        await _inscribir(cliente, "aviso-reenvio")

        assert correos["pendiente"].await_count == 2
        assert correos["organizador"].await_count == 1

    async def test_con_verificacion_no_avisa_hasta_verificar(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        await _crear_y_publicar_evento(cliente, cabeceras, "aviso-verificar")

        await _verificar_cuentas()
        await _inscribir(cliente, "aviso-verificar")
        assert correos["organizador"].await_count == 0

        await _verificar(cliente, "asistente@example.com")
        assert correos["organizador"].await_count == 1

    async def test_aprobar_no_vuelve_a_avisar(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_y_publicar_evento(
            cliente,
            cabeceras,
            "aviso-aprobar",
            email_verification_required=False,
            registration_mode="approval",
        )
        await _verificar_cuentas()
        await _inscribir(cliente, "aviso-aprobar")
        registration_id = await _registration_id("asistente@example.com")

        respuesta = await cliente.post(
            f"{EVENTS}/{evento['id']}/registrations/{registration_id}/approve", headers=cabeceras
        )

        assert respuesta.status_code == 200, respuesta.text
        assert correos["organizador"].await_count == 1

    async def test_sin_nadie_con_el_correo_verificado_usa_el_contacto_de_la_organizacion(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        await _crear_y_publicar_evento(
            cliente, cabeceras, "aviso-contacto", email_verification_required=False
        )
        async with SessionMaintenance() as session:
            await session.execute(
                text("UPDATE users SET email_verified_at = NULL WHERE id = :id"),
                {"id": organizacion.owner_id},
            )
            await session.execute(
                text("UPDATE organizations SET contact_email = 'hola@acme.example' WHERE id = :id"),
                {"id": organizacion.id},
            )
            await session.commit()

        await _inscribir(cliente, "aviso-contacto")

        assert _destinatarios(correos["organizador"]) == ["hola@acme.example"]

    async def test_sin_nadie_ni_contacto_no_encola_nada(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, correos
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        await _crear_y_publicar_evento(
            cliente, cabeceras, "aviso-nadie", email_verification_required=False
        )
        async with SessionMaintenance() as session:
            await session.execute(
                text("UPDATE users SET is_active = false WHERE id = :id"),
                {"id": organizacion.owner_id},
            )
            await session.execute(
                text("UPDATE organizations SET contact_email = NULL WHERE id = :id"),
                {"id": organizacion.id},
            )
            await session.commit()

        respuesta = await _inscribir(cliente, "aviso-nadie")

        assert respuesta.status_code < 300, respuesta.text
        assert correos["organizador"].await_count == 0


class TestTrasCommit:
    async def test_lo_apuntado_sale_tras_el_commit(self) -> None:
        accion = AsyncMock()
        generador = get_session()
        session = await generador.__anext__()
        encolar_tras_commit(session, accion)

        accion.assert_not_awaited()
        with pytest.raises(StopAsyncIteration):
            await generador.__anext__()
        accion.assert_awaited_once()

    async def test_si_la_transaccion_se_revierte_no_sale_nada(self) -> None:
        accion = AsyncMock()
        generador = get_session()
        session = await generador.__anext__()
        encolar_tras_commit(session, accion)

        with pytest.raises(RuntimeError):
            await generador.athrow(RuntimeError("la petición falla"))
        accion.assert_not_awaited()


class TestTrasCommitEnMantenimiento:
    async def test_maintenance_session_despacha_tras_commit_y_no_tras_rollback(self) -> None:
        bien, mal = AsyncMock(), AsyncMock()

        async with maintenance_session() as session:
            encolar_tras_commit(session, bien)
        bien.assert_awaited_once()

        with pytest.raises(RuntimeError):
            async with maintenance_session() as session:
                encolar_tras_commit(session, mal)
                raise RuntimeError("el cron falla")
        mal.assert_not_awaited()


class TestCuerpoDelAviso:
    def test_un_dominio_suelto_en_el_nombre_tampoco_queda_como_enlace(self) -> None:
        assert (
            neutralizar_texto_de_usuario("Ana evil-acme.com/login verifica")
            == "Ana evil-acme[.]com/login verifica"
        )
        assert neutralizar_texto_de_usuario("José María") == "José María"

    async def test_el_boton_va_al_panel_y_el_nombre_no_puede_ser_un_enlace(
        self, organizacion: OrganizacionDePrueba, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enviados: list[dict[str, str]] = []

        class _Proveedor:
            async def send(self, **mensaje: str) -> None:
                enviados.append(mensaje)

        monkeypatch.setattr(tasks, "get_email_provider", lambda: _Proveedor())
        event_id, registration_id = str(uuid.uuid4()), str(uuid.uuid4())

        await send_registration_received_organizer_email(
            "org@example.com",
            str(organizacion.id),
            event_id,
            registration_id,
            "Jornada IA",
            "https://malicioso.example/acceso\n\nEstado: confirmada",
            "x@example.com",
            "pending_approval",
        )

        cuerpo = enviados[0]["body"]
        primera_linea = cuerpo.split("\n", 1)[0]
        assert primera_linea.endswith(
            f"/dashboard/events/{event_id}/registrations/{registration_id}"
        )
        assert "https://malicioso" not in cuerpo
        assert "https[:]//malicioso[.]example/acceso Estado: confirmada" in cuerpo
        assert "Correo: x@example.com" in cuerpo
        assert enviados[0]["subject"] == "Inscripción pendiente de aprobar en Jornada IA"
