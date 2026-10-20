"""Cambios de modo de inscripción y de aforo de un evento con inscripciones.

El formulario del panel envía siempre `registration_mode` y `capacity`: las
guardas solo actúan cuando el valor cambia, rechazan los cambios que dejarían
inscripciones sin salida y, al subir el aforo, ofrecen las plazas nuevas a la
lista de espera.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import SessionMaintenance
from app.core.tasks import send_waitlist_promotion_email
from app.modules.events.models import Event
from app.modules.registrations import repository as registrations_repository
from app.modules.registrations.models import EventRegistration
from tests.conftest import OrganizacionDePrueba, iniciar_sesion

EVENTS = "/api/v1/events"
AHORA = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture(autouse=True)
def promocion_encolada():
    with patch.object(send_waitlist_promotion_email, "kiq", new_callable=AsyncMock) as tarea:
        yield tarea


async def _crear_evento(
    cliente: AsyncClient, cabeceras: dict[str, str], slug: str, **overrides: object
) -> dict:
    payload: dict[str, object] = {
        "slug": slug,
        "title": f"Evento {slug}",
        "starts_at": (AHORA + timedelta(days=10)).isoformat(),
        "ends_at": (AHORA + timedelta(days=11)).isoformat(),
        "location_mode": "in_person",
    }
    payload.update(overrides)
    respuesta = await cliente.post(EVENTS, headers=cabeceras, json=payload)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


async def _inscribir(
    organizacion: OrganizacionDePrueba, evento: dict, status: str, *, email: str | None = None
) -> str:
    ahora = datetime.now(UTC)
    async with SessionMaintenance() as session:
        inscripcion = EventRegistration(
            event_id=uuid.UUID(evento["id"]),
            organization_id=organizacion.id,
            email=email or f"{uuid.uuid4().hex[:10]}@example.com",
            full_name="Asistente de Prueba",
            status=status,
            confirmed_at=ahora if status == "confirmed" else None,
            payment_expires_at=ahora + timedelta(minutes=30)
            if status == "pending_payment"
            else None,
        )
        session.add(inscripcion)
        await session.commit()
        await session.refresh(inscripcion)
        return str(inscripcion.id)


async def _publicar(cliente: AsyncClient, cabeceras: dict[str, str], evento: dict) -> None:
    respuesta = await cliente.patch(
        f"{EVENTS}/{evento['id']}",
        headers=cabeceras,
        json={"status": "published", "visibility": "public"},
    )
    assert respuesta.status_code == 200, respuesta.text


async def _patch(
    cliente: AsyncClient, cabeceras: dict[str, str], evento: dict, **datos: object
) -> tuple[int, dict]:
    respuesta = await cliente.patch(f"{EVENTS}/{evento['id']}", headers=cabeceras, json=datos)
    return respuesta.status_code, respuesta.json()


class TestCambioDeModo:
    @pytest.mark.parametrize(
        "estado", ["pending_verification", "pending_approval", "waitlisted", "confirmed"]
    )
    async def test_pasar_a_pago_con_inscripciones_sin_pago_se_rechaza(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba, estado: str
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, f"a-pago-{estado.replace('_', '-')}")
        await _inscribir(organizacion, evento, estado)

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode="paid")

        assert codigo == 409, cuerpo
        assert "sin pago" in str(cuerpo)

    async def test_pasar_a_pago_sin_inscripciones_se_permite(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "a-pago-vacio")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode="paid")

        assert codigo == 200, cuerpo
        assert cuerpo["registration_mode"] == "paid"

    async def test_salir_de_pago_con_compras_a_medias_se_rechaza(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(
            cliente, cabeceras, "de-pago-a-medias", registration_mode="paid"
        )
        await _inscribir(organizacion, evento, "pending_payment")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode="free")

        assert codigo == 409, cuerpo
        assert "pendientes de pago" in str(cuerpo)

    async def test_salir_de_pago_con_lista_de_espera_se_rechaza(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(
            cliente, cabeceras, "de-pago-en-espera", registration_mode="paid"
        )
        await _inscribir(organizacion, evento, "waitlisted")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode="free")

        assert codigo == 409, cuerpo
        assert "compra iniciada" in str(cuerpo)

    async def test_modo_nulo_se_rechaza(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "modo-nulo")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode=None)

        assert codigo == 422, cuerpo

    async def test_salir_de_pago_con_inscripciones_confirmadas_se_permite(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(
            cliente, cabeceras, "de-pago-pagadas", registration_mode="paid"
        )
        await _inscribir(organizacion, evento, "confirmed")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode="free")

        assert codigo == 200, cuerpo

    async def test_de_aprobacion_a_libre_con_pendientes_se_permite(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(
            cliente, cabeceras, "aprobacion-a-libre", registration_mode="approval"
        )
        await _inscribir(organizacion, evento, "pending_approval")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, registration_mode="free")

        assert codigo == 200, cuerpo

    async def test_reenviar_el_mismo_modo_no_valida(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(
            cliente, cabeceras, "mismo-modo-pago", registration_mode="paid"
        )
        await _inscribir(organizacion, evento, "pending_payment")

        codigo, cuerpo = await _patch(
            cliente, cabeceras, evento, registration_mode="paid", title="Título nuevo"
        )

        assert codigo == 200, cuerpo


class TestCambioDeAforo:
    async def test_bajar_por_debajo_de_las_reservadas_se_rechaza(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-bajo", capacity=5)
        for _ in range(3):
            await _inscribir(organizacion, evento, "confirmed")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, capacity=2)

        assert codigo == 409, cuerpo
        assert "3 plazas" in str(cuerpo)

    async def test_reenviar_el_mismo_aforo_superado_no_bloquea_otros_cambios(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-superado", capacity=1)
        for _ in range(2):
            await _inscribir(organizacion, evento, "confirmed")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, capacity=1, title="Otro título")

        assert codigo == 200, cuerpo

    async def test_subir_aforo_promueve_lista_de_espera_hasta_llenar(
        self,
        cliente: AsyncClient,
        organizacion: OrganizacionDePrueba,
        promocion_encolada: AsyncMock,
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-sube", capacity=1)
        await _publicar(cliente, cabeceras, evento)
        await _inscribir(organizacion, evento, "confirmed")
        for _ in range(3):
            await _inscribir(organizacion, evento, "waitlisted")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, capacity=3)

        assert codigo == 200, cuerpo
        assert promocion_encolada.await_count == 2
        async with SessionMaintenance() as session:
            promovidas = await session.scalar(
                text(
                    "SELECT count(*) FROM event_registrations "
                    "WHERE event_id = :id AND waitlist_promoted_at IS NOT NULL"
                ),
                {"id": evento["id"]},
            )
        assert promovidas == 2

    async def test_quitar_aforo_promueve_a_toda_la_lista_de_espera(
        self,
        cliente: AsyncClient,
        organizacion: OrganizacionDePrueba,
        promocion_encolada: AsyncMock,
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-quitado", capacity=1)
        await _publicar(cliente, cabeceras, evento)
        await _inscribir(organizacion, evento, "confirmed")
        for _ in range(2):
            await _inscribir(organizacion, evento, "waitlisted")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, capacity=None)

        assert codigo == 200, cuerpo
        assert promocion_encolada.await_count == 2

    async def test_poner_aforo_a_un_evento_sin_limite_valida_las_reservadas(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-nuevo")
        for _ in range(3):
            await _inscribir(organizacion, evento, "confirmed")

        assert (await _patch(cliente, cabeceras, evento, capacity=2))[0] == 409
        assert (await _patch(cliente, cabeceras, evento, capacity=3))[0] == 200

    async def test_en_borrador_subir_aforo_no_promueve(
        self,
        cliente: AsyncClient,
        organizacion: OrganizacionDePrueba,
        promocion_encolada: AsyncMock,
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-borrador", capacity=1)
        await _inscribir(organizacion, evento, "waitlisted")

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, capacity=5)

        assert codigo == 200, cuerpo
        promocion_encolada.assert_not_awaited()

    async def test_una_promocion_caducada_sin_barrer_vuelve_a_la_cola(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "aforo-caducada", capacity=2)
        await _inscribir(organizacion, evento, "confirmed")
        caducada = await _inscribir(organizacion, evento, "waitlisted")
        async with SessionMaintenance() as session:
            await session.execute(
                text(
                    "UPDATE event_registrations SET waitlist_promoted_at = :inicio, "
                    "waitlist_promotion_expires_at = :fin WHERE id = :id"
                ),
                {
                    "inicio": AHORA - timedelta(days=2),
                    "fin": AHORA - timedelta(days=1),
                    "id": caducada,
                },
            )
            await session.commit()

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, capacity=1)

        assert codigo == 200, cuerpo
        async with SessionMaintenance() as session:
            promovida_en = await session.scalar(
                text("SELECT waitlist_promoted_at FROM event_registrations WHERE id = :id"),
                {"id": caducada},
            )
        assert promovida_en is None


class TestBloqueoDeAforo:
    async def test_el_bloqueo_lee_el_aforo_vigente_aunque_el_evento_ya_este_cargado(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "bloqueo-vigente", capacity=10)
        event_id = uuid.UUID(evento["id"])

        async with SessionMaintenance() as lectora:
            cargado = await lectora.get(Event, event_id)
            assert cargado is not None and cargado.capacity == 10
            async with SessionMaintenance() as otra:
                await otra.execute(
                    text("UPDATE events SET capacity = 5 WHERE id = :id"), {"id": evento["id"]}
                )
                await otra.commit()

            bloqueado = await registrations_repository.lock_event_for_capacity(
                lectora, organizacion.id, event_id
            )

        assert bloqueado is cargado
        assert bloqueado.capacity == 5


class TestDescripcion:
    async def test_una_descripcion_de_mas_de_20000_caracteres_se_rechaza(
        self, cliente: AsyncClient, organizacion: OrganizacionDePrueba
    ) -> None:
        _, cabeceras = await iniciar_sesion(cliente, organizacion)
        evento = await _crear_evento(cliente, cabeceras, "descripcion-larga")

        codigo, _ = await _patch(cliente, cabeceras, evento, description="a" * 20001)
        assert codigo == 422

        codigo, cuerpo = await _patch(cliente, cabeceras, evento, description="**Hola**")
        assert codigo == 200
        assert cuerpo["description"] == "**Hola**"
