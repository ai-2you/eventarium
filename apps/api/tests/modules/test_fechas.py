"""Las horas de los correos van en la zona del evento, también al cambiar la hora."""

from __future__ import annotations

from datetime import UTC, datetime

from app.core.fechas import fecha_y_hora


def test_respeta_el_cambio_de_hora_de_octubre() -> None:
    # El 25-oct-2026 Madrid pasa de UTC+2 a UTC+1.
    assert fecha_y_hora(datetime(2026, 10, 24, 16, 0, tzinfo=UTC), "Europe/Madrid") == (
        "24/10/2026 18:00"
    )
    assert fecha_y_hora(datetime(2026, 10, 26, 16, 0, tzinfo=UTC), "Europe/Madrid") == (
        "26/10/2026 17:00"
    )


def test_una_zona_desconocida_no_rompe_y_usa_madrid() -> None:
    assert fecha_y_hora(datetime(2026, 11, 1, 12, 0, tzinfo=UTC), "Madrid") == "01/11/2026 13:00"
