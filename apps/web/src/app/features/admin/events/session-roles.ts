import type { SelectOption } from '../../../shared/ui/select';
import { rolLegible } from '../../public/events/event-page.types';

/** Roles de una persona en una sesión. Las claves son las que la ficha pública
 * sabe traducir (`publico.eventos.rol.*`): nunca la etiqueta en español. */
export const ROLES_DE_SESION = ['speaker', 'moderator', 'presenter'] as const;

/** Una persona del roster en una sesión (`GET /events/{id}/participations`). */
export interface Participacion {
  readonly event_member_id: string;
  readonly session_id: string;
  readonly session_title: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly role_key: string;
}

export interface Franja {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
}

/**
 * Opciones del desplegable de rol: «No participa», el catálogo y, si la persona
 * ya tenía guardado otra cosa (un rol libre antiguo o varios a la vez, como
 * `speaker,moderator`), esa misma combinación, para que guardar no la pierda.
 */
export function opcionesDeRol(
  traducir: (clave: string) => string,
  valorActual: string,
): SelectOption[] {
  const opciones: SelectOption[] = [
    { value: '', label: traducir('admin.events.agenda.participantes.noParticipa') },
    ...ROLES_DE_SESION.map((rol) => ({ value: rol, label: rolLegible(rol, traducir) })),
  ];
  if (valorActual && !opciones.some((opcion) => opcion.value === valorActual)) {
    opciones.push({
      value: valorActual,
      label: valorActual
        .split(',')
        .map((rol) => rolLegible(rol.trim(), traducir))
        .join(' + '),
    });
  }
  return opciones;
}

/** Dos franjas se solapan si una empieza antes de que acabe la otra (tocarse en
 * el borde, 10:00–11:00 y 11:00–12:00, no es solaparse). */
export function seSolapan(a: Franja, b: Franja): boolean {
  return (
    Date.parse(a.starts_at) < Date.parse(b.ends_at) &&
    Date.parse(b.starts_at) < Date.parse(a.ends_at)
  );
}

/** Otras sesiones de esa persona que coinciden en hora con `sesion`, sin repetir. */
export function solapesDe(
  eventMemberId: string,
  sesion: Franja,
  participaciones: readonly Participacion[],
): Participacion[] {
  const vistas = new Set<string>();
  return participaciones.filter((participacion) => {
    if (participacion.event_member_id !== eventMemberId) return false;
    if (participacion.session_id === sesion.id || vistas.has(participacion.session_id))
      return false;
    const coincide = seSolapan(sesion, {
      id: participacion.session_id,
      starts_at: participacion.starts_at,
      ends_at: participacion.ends_at,
    });
    if (coincide) vistas.add(participacion.session_id);
    return coincide;
  });
}
