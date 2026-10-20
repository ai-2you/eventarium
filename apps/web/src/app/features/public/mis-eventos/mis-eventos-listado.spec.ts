import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MisEventosListado } from './mis-eventos-listado';
import type { MyRegistrationItem } from '../../../core/registrations/registrations.service';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';

const DIA = 24 * 60 * 60 * 1000;
// Fechas holgadas respecto a ahora: el resultado no depende del minuto en que
// se ejecute el test.
const iso = (desplazamiento: number): string => new Date(Date.now() + desplazamiento).toISOString();

function inscripcion(
  slug: string,
  inicio: number,
  fin: number,
  extra: Partial<MyRegistrationItem> = {},
): MyRegistrationItem {
  return {
    organization: { slug: 'acme', name: 'Acme', page_public: false },
    event_slug: slug,
    event_title: `Evento ${slug}`,
    starts_at: iso(inicio),
    ends_at: iso(fin),
    timezone: 'Europe/Madrid',
    organization_name: 'Acme',
    status: 'confirmed',
    calendar: {
      organization: { slug: 'acme' },
      slug,
      title: `Evento ${slug}`,
      starts_at: iso(inicio),
      ends_at: iso(fin),
      timezone: 'Europe/Madrid',
      location: null,
    },
    ...extra,
  };
}

describe('MisEventosListado', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function montar(filas: readonly MyRegistrationItem[]) {
    const fixture = TestBed.createComponent(MisEventosListado);
    fixture.componentRef.setInput('inscripciones', filas);
    await fixture.whenStable();
    const raiz = fixture.nativeElement as HTMLElement;
    const panel = (id: string) => raiz.querySelector(`#mis-eventos-panel-${id}`) as HTMLElement;
    return { fixture, raiz, panel };
  }

  it('separa próximos y pasados, con el evento en curso entre los próximos', async () => {
    const { raiz, panel } = await montar([
      inscripcion('lejano', 20 * DIA, 21 * DIA),
      inscripcion('en-curso', -DIA, DIA),
      inscripcion('antiguo', -30 * DIA, -29 * DIA),
      inscripcion('reciente', -3 * DIA, -2 * DIA),
    ]);

    const slugs = (id: string) =>
      [...panel(id).querySelectorAll('li > a')].map((a) => a.textContent?.trim());
    expect(slugs('proximos')).toEqual(['Evento en-curso', 'Evento lejano']);
    expect(slugs('pasados')).toEqual(['Evento reciente', 'Evento antiguo']);
    const pestanas = [...raiz.querySelectorAll('[role="tab"]')].map((b) => b.textContent?.trim());
    expect(pestanas).toEqual(['Próximos (2)', 'Pasados (2)']);
    expect(panel('pasados').hidden).toBe(true);
  });

  it('ofrece el calendario solo en próximos con calendario de la API', async () => {
    const { panel } = await montar([
      inscripcion('confirmado', 2 * DIA, 3 * DIA),
      inscripcion('en-espera', 2 * DIA, 3 * DIA, { status: 'waitlisted', calendar: null }),
      inscripcion('pasado', -3 * DIA, -2 * DIA),
    ]);

    expect(panel('proximos').querySelectorAll('app-add-to-calendar')).toHaveLength(1);
    expect(panel('pasados').querySelector('app-add-to-calendar')).toBeNull();
  });

  it('cambia de pestaña con las flechas, Inicio y Fin', async () => {
    const { fixture, raiz, panel } = await montar([inscripcion('a', DIA, 2 * DIA)]);
    const [proximos] = [...raiz.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    proximos.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    await fixture.whenStable();
    expect(panel('pasados').hidden).toBe(false);
    expect(proximos.getAttribute('tabindex')).toBe('-1');

    proximos.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await fixture.whenStable();
    expect(panel('proximos').hidden).toBe(false);
  });

  it('sin próximos lo dice y enlaza a los eventos', async () => {
    const { panel, raiz } = await montar([]);

    expect(panel('proximos').textContent).toContain(es.publico.misEventos.vacio.proximos);
    expect(panel('proximos').querySelector('a')).not.toBeNull();
    await esperarSinViolacionesDeAccesibilidad(raiz);
  });

  it('un evento que termina justo ahora sigue en próximos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    const { panel } = await montar([
      {
        ...inscripcion('limite', 0, 0),
        starts_at: '2026-10-21T08:00:00Z',
        ends_at: '2026-10-21T10:00:00Z',
      },
      {
        ...inscripcion('un-segundo-antes', 0, 0),
        starts_at: '2026-10-21T08:00:00Z',
        ends_at: '2026-10-21T09:59:59Z',
      },
    ]);

    expect(panel('proximos').textContent).toContain('Evento limite');
    expect(panel('pasados').textContent).toContain('Evento un-segundo-antes');
  });

  it('pinta la hora en la zona del evento, no en la del navegador', async () => {
    const { panel } = await montar([
      {
        ...inscripcion('nueva-york', DIA, 2 * DIA),
        starts_at: '2030-07-01T16:00:00Z',
        ends_at: '2030-07-01T18:00:00Z',
        timezone: 'America/New_York',
      },
    ]);

    // 16:00 UTC en julio son las 12:00 en Nueva York (y las 18:00 en Madrid).
    expect(panel('proximos').querySelector('.detalle')?.textContent).toContain('12:00');
  });
});
