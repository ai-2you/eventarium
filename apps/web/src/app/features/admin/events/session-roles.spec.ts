import { describe, expect, it } from 'vitest';

import { type Participacion, opcionesDeRol, seSolapan, solapesDe } from './session-roles';

const traducir = (clave: string): string => clave;

function participacion(sesion: string, inicio: string, fin: string): Participacion {
  return {
    event_member_id: 'm1',
    session_id: sesion,
    session_title: `Sesión ${sesion}`,
    starts_at: inicio,
    ends_at: fin,
    role_key: 'speaker',
  };
}

describe('roles de sesión', () => {
  it('ofrece el catálogo y conserva una combinación guardada que no está en él', () => {
    expect(opcionesDeRol(traducir, '').map((opcion) => opcion.value)).toEqual([
      '',
      'speaker',
      'moderator',
      'presenter',
    ]);
    const conAntigua = opcionesDeRol(traducir, 'speaker,moderator');
    expect(conAntigua.at(-1)).toEqual({
      value: 'speaker,moderator',
      label: 'publico.eventos.rol.speaker + publico.eventos.rol.moderator',
    });
  });

  it('tocarse en el borde no es solaparse', () => {
    const a = { id: 'a', starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T11:00:00Z' };
    expect(
      seSolapan(a, { id: 'b', starts_at: '2030-01-01T11:00:00Z', ends_at: '2030-01-01T12:00:00Z' }),
    ).toBe(false);
    expect(
      seSolapan(a, { id: 'c', starts_at: '2030-01-01T10:30:00Z', ends_at: '2030-01-01T11:30:00Z' }),
    ).toBe(true);
  });

  it('solapesDe ignora la propia sesión y no repite la que aparece por varios roles', () => {
    const sesion = { id: 's1', starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T11:00:00Z' };
    const solapes = solapesDe('m1', sesion, [
      participacion('s1', sesion.starts_at, sesion.ends_at),
      participacion('s2', '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z'),
      {
        ...participacion('s2', '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z'),
        role_key: 'moderator',
      },
      participacion('s3', '2030-01-01T12:00:00Z', '2030-01-01T13:00:00Z'),
    ]);
    expect(solapes.map((solape) => solape.session_id)).toEqual(['s2']);
  });
});
