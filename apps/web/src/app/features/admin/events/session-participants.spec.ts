import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionParticipants } from './session-participants';
import { elegirEnSelect } from '../../../../testing/select';
import es from '../../../../../public/assets/i18n/es-ES.json';

const BASE = '/api/v1/events/e1';
const ROSTER = [
  {
    id: 'm1',
    organization_member_id: 'o1',
    role_key: 'speaker',
    email: 'ana@x.es',
    first_name: 'Ana',
    last_name: 'Pérez',
  },
  {
    id: 'm2',
    organization_member_id: 'o2',
    role_key: 'speaker',
    email: 'bea@x.es',
    first_name: 'Bea',
    last_name: 'Ruiz',
  },
];

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SessionParticipants', () => {
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
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function montar(): Promise<ComponentFixture<SessionParticipants>> {
    const fixture = TestBed.createComponent(SessionParticipants);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('updatedAt', '2030-01-01T00:00:00Z');
    fixture.componentRef.setInput('roster', ROSTER);
    fixture.componentRef.setInput('inicio', '2030-01-01T10:00:00Z');
    fixture.componentRef.setInput('fin', '2030-01-01T11:00:00Z');
    await avanzar(fixture);
    // Ana tenía guardados dos roles a la vez; Bea, ninguno.
    http.expectOne(`${BASE}/sessions/s1/participants`).flush([
      { id: 'p1', event_member_id: 'm1', role_key: 'speaker' },
      { id: 'p2', event_member_id: 'm1', role_key: 'moderator' },
    ]);
    http.expectOne(`${BASE}/participations`).flush([
      {
        event_member_id: 'm1',
        session_id: 's2',
        session_title: 'Mesa redonda',
        starts_at: '2030-01-01T10:30:00Z',
        ends_at: '2030-01-01T11:30:00Z',
        role_key: 'speaker',
      },
    ]);
    await avanzar(fixture);
    return fixture;
  }

  it('conserva los roles guardados, avisa del solape y envía lo elegido en el desplegable', async () => {
    const fixture = await montar();
    const texto = (): string => fixture.nativeElement.textContent as string;
    expect(texto()).toContain('Ponente + Moderador/a');
    expect(texto()).toContain('Ojo: a esta hora también está en «Mesa redonda»');

    elegirEnSelect(fixture, 'participante-s1-m2', 'presenter');
    await avanzar(fixture);
    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Guardar participantes'))!;
    boton.click();
    await avanzar(fixture);

    const guardar = http.expectOne(
      (peticion) =>
        peticion.method === 'PUT' && peticion.url === `${BASE}/sessions/s1/participants`,
    );
    expect(guardar.request.body.participants).toEqual([
      { event_member_id: 'm1', role_key: 'speaker' },
      { event_member_id: 'm1', role_key: 'moderator' },
      { event_member_id: 'm2', role_key: 'presenter' },
    ]);
    guardar.flush([]);
  });
});
