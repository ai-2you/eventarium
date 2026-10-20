import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SpeakerSessionAssign } from './speaker-session-assign';
import { elegirEnSelect } from '../../../../testing/select';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';

const BASE = '/api/v1/events/e1';

function sesion(id: string, titulo: string, inicio: string, fin: string, version = 'v1') {
  return {
    id,
    session_type: 'talk',
    title: titulo,
    starts_at: inicio,
    ends_at: fin,
    room: null,
    video_platform: null,
    video_url: null,
    materials: [],
    sort_order: 0,
    venue_id: null,
    updated_at: version,
  };
}

const SESIONES = [
  sesion('s1', 'Apertura', '2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z'),
  sesion('s2', 'Mesa redonda', '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z'),
];
// La persona ya está en la apertura; la mesa redonda no se solapa con ella.
const PARTICIPACIONES = [
  {
    event_member_id: 'm1',
    session_id: 's1',
    session_title: 'Apertura',
    starts_at: '2030-01-01T09:00:00Z',
    ends_at: '2030-01-01T10:00:00Z',
    role_key: 'speaker',
  },
];

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SpeakerSessionAssign', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function montar(): Promise<ComponentFixture<SpeakerSessionAssign>> {
    const fixture = TestBed.createComponent(SpeakerSessionAssign);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.componentRef.setInput('eventMemberId', 'm1');
    await avanzar(fixture);
    http.expectOne(`${BASE}/sessions`).flush(SESIONES);
    http.expectOne(`${BASE}/participations`).flush(PARTICIPACIONES);
    await avanzar(fixture);
    // `Promise.all`: una vuelta más para que el `finally` llegue al DOM.
    await avanzar(fixture);
    return fixture;
  }

  function botonAsignar(fixture: ComponentFixture<unknown>): HTMLButtonElement {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((boton) => boton.textContent?.trim() === 'Asignar')!;
  }

  it('añade a la persona sin quitar a nadie, con la versión leída antes que la lista', async () => {
    const fixture = await montar();
    expect(fixture.nativeElement.textContent).toContain('Ya está en:');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);

    elegirEnSelect(fixture, 'asignar-sesion', 's2');
    await avanzar(fixture);
    botonAsignar(fixture).click();
    await avanzar(fixture);

    http.expectOne(`${BASE}/sessions`).flush([SESIONES[0], { ...SESIONES[1], updated_at: 'v2' }]);
    await avanzar(fixture);
    http
      .expectOne((p) => p.method === 'GET' && p.url === `${BASE}/sessions/s2/participants`)
      .flush([{ event_member_id: 'm9', role_key: 'moderator' }]);
    await avanzar(fixture);
    const guardar = http.expectOne((p) => p.method === 'PUT');
    expect(guardar.request.body).toEqual({
      expected_updated_at: 'v2',
      participants: [
        { event_member_id: 'm9', role_key: 'moderator' },
        { event_member_id: 'm1', role_key: 'speaker' },
      ],
    });
    guardar.flush([]);
    await avanzar(fixture);
    http.expectOne(`${BASE}/sessions`).flush(SESIONES);
    http.expectOne(`${BASE}/participations`).flush(PARTICIPACIONES);
    await avanzar(fixture);
    // `Promise.all`: una vuelta más para que el `finally` llegue al DOM.
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).toContain('Asignado a «Mesa redonda»');
  });

  it('no duplica a quien ya tiene ese rol en la sesión', async () => {
    const fixture = await montar();
    elegirEnSelect(fixture, 'asignar-sesion', 's1');
    await avanzar(fixture);
    botonAsignar(fixture).click();
    await avanzar(fixture);
    http.expectOne(`${BASE}/sessions`).flush(SESIONES);
    await avanzar(fixture);
    http
      .expectOne(`${BASE}/sessions/s1/participants`)
      .flush([{ event_member_id: 'm1', role_key: 'speaker' }]);
    await avanzar(fixture);

    http.expectNone((p) => p.method === 'PUT');
    expect(fixture.nativeElement.textContent).toContain('Ya está asignado a esa sesión');
  });
});
