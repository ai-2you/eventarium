"""Texto del correo de recordatorio.

Título, lugar y dirección los escribe el organizador: pasan por
`neutralizar_texto_de_usuario` para que una URL dentro no se convierta en el
botón de un correo que sale con el remitente de la plataforma. El botón es la
primera URL del cuerpo, así que el orden es: «mi entrada», cancelar y, al
final, el enlace para conectarse a un evento en línea (sin neutralizar: tiene
que funcionar).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.core.email_template import neutralizar_texto_de_usuario
from app.core.fechas import fecha_y_hora


@dataclass(frozen=True, slots=True)
class DatosDelRecordatorio:
    titulo: str
    inicio: datetime
    zona: str
    modalidad: str
    lugar: str | None
    direccion: str | None
    ciudad: str | None
    url_online: str | None
    enlace_mi_entrada: str
    enlace_cancelacion: str
    hay_lista_de_espera: bool
    # `en_curso`: se devolvería el importe; `sin_reembolso`: ya no; `None`: sin pago.
    reembolso: str | None
    limite_de_reembolso: datetime | None


def _donde(datos: DatosDelRecordatorio) -> str | None:
    if datos.modalidad == "online":
        return "En línea (el enlace para conectarte está al final de este correo)."
    partes = [
        neutralizar_texto_de_usuario(parte)
        for parte in (datos.lugar, datos.direccion, datos.ciudad)
        if parte and parte.strip()
    ]
    if not partes:
        return None
    sede = ", ".join(partes)
    if datos.modalidad == "hybrid":
        return f"{sede} (o en línea: el enlace está al final de este correo)."
    return sede


def asunto_y_cuerpo(datos: DatosDelRecordatorio) -> tuple[str, str]:
    titulo = neutralizar_texto_de_usuario(datos.titulo)
    cuando = fecha_y_hora(datos.inicio, datos.zona)
    asunto = f"Recordatorio: {titulo} — {cuando}"

    lineas = [
        "Hola,",
        f"Te recordamos tu inscripción a «{titulo}».",
        f"Cuándo: {cuando} (hora del evento)",
    ]
    donde = _donde(datos)
    if donde:
        lineas.append(f"Dónde: {donde}")
    parrafos = [
        lineas[0],
        "\n".join(lineas[1:]),
        "Tu entrada es el código QR de este correo: muéstrala en la puerta. "
        f"También puedes verla aquí:\n{datos.enlace_mi_entrada}",
    ]
    otra_persona = " para otra persona de la lista de espera" if datos.hay_lista_de_espera else ""
    parrafos.append(
        f"¿No puedes ir? Cancela tu inscripción y tu plaza quedará libre{otra_persona}:\n"
        f"{datos.enlace_cancelacion}"
    )
    if datos.reembolso == "en_curso" and datos.limite_de_reembolso is not None:
        parrafos.append(
            "Si cancelas antes del "
            f"{fecha_y_hora(datos.limite_de_reembolso, datos.zona)}, se te devuelve el importe."
        )
    elif datos.reembolso == "sin_reembolso":
        parrafos.append(
            "Ya ha pasado el plazo de reembolso: si cancelas, no se devuelve el importe."
        )
    parrafos.append(
        "Las ausencias sin avisar pueden tenerse en cuenta al revisar tus próximas inscripciones."
    )
    if datos.url_online and datos.modalidad in ("online", "hybrid"):
        parrafos.append(f"Enlace para conectarte:\n{datos.url_online}")
    return asunto, "\n\n".join(parrafos)
