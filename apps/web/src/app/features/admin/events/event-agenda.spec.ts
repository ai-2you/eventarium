import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';
import { EventAgenda } from './event-agenda';

function sesiones() {
  return [
    {
      id: 's1',
      session_type: 'talk',
      title: 'Charla de apertura',
      starts_at: '2026-10-01T09:00:00Z',
      ends_at: '2026-10-01T10:00:00Z',
      room: 'Sala A',
      video_platform: null,
      video_url: null,
      materials: [{ url: 'https://ejemplo.com/slides.pdf' }],
      sort_order: 0,
    },
  ];
}

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

/** El roster y los miembros de la organización se piden en paralelo a la agenda. */
function flushRoster(http: HttpTestingController): void {
  http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/members').flush([]);
  http
    .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
    .flush({ items: [], total: 0, limit: 200, offset: 0 });
}

/** Las sedes del evento se piden dos veces en paralelo a la agenda: una desde
 * `app-event-venues` (su propio listado) y otra desde el selector de sede del
 * formulario de sesión, cada una por su cuenta. */
function flushVenues(http: HttpTestingController): void {
  for (const peticion of http.match((p) => p.url === '/api/v1/events/e1/venues')) {
    peticion.flush([]);
  } // El formulario de sesión pide el evento para limitar las fechas a su rango.
  for (const peticion of http.match((p) => p.url === '/api/v1/events/e1')) {
    peticion.flush({ starts_at: '2000-01-01T00:00:00Z', ends_at: '2100-01-01T00:00:00Z' });
  }
}

describe('EventAgenda', () => {
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

  afterEach(() => {
    http.verify();
  });

  it('lista las sesiones agrupadas por día y no tiene violaciones de accesibilidad', async () => {
    const fixture = TestBed.createComponent(EventAgenda);
    fixture.componentRef.setInput('eventId', 'e1');
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
    flushRoster(http);
    flushVenues(http);
    await avanzar(fixture);

    expect(fixture.nativeElement.textContent).toContain('Charla de apertura');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('añade una sesión nueva con el formulario', async () => {
    const fixture = TestBed.createComponent(EventAgenda);
    fixture.componentRef.setInput('eventId', 'e1');
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush([]);
    flushRoster(http);
    flushVenues(http);
    await avanzar(fixture);

    const titulo = fixture.nativeElement.querySelector('#sesion-titulo') as HTMLInputElement;
    titulo.value = 'Nueva sesión';
    titulo.dispatchEvent(new Event('input'));
    const inicio = fixture.nativeElement.querySelector('#sesion-inicio-nativo') as HTMLInputElement;
    inicio.value = '2026-10-01T11:00';
    inicio.dispatchEvent(new Event('input'));
    const fin = fixture.nativeElement.querySelector('#sesion-fin-nativo') as HTMLInputElement;
    fin.value = '2026-10-01T12:00';
    fin.dispatchEvent(new Event('input'));
    await avanzar(fixture);

    (fixture.nativeElement.querySelector('app-session-form form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await avanzar(fixture);

    const peticion = http.expectOne(
      (peticion) => peticion.url === '/api/v1/events/e1/sessions' && peticion.method === 'POST',
    );
    expect(peticion.request.body.title).toBe('Nueva sesión');
    peticion.flush({
      id: 's2',
      session_type: 'talk',
      title: 'Nueva sesión',
      starts_at: '2026-10-01T11:00:00Z',
      ends_at: '2026-10-01T12:00:00Z',
      room: null,
      video_platform: null,
      video_url: null,
      materials: [],
      sort_order: 0,
    });
    await avanzar(fixture);

    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
  });

  it('no envía una sesión que termina antes de empezar ni una fuera del evento', async () => {
    const fixture = TestBed.createComponent(EventAgenda);
    fixture.componentRef.setInput('eventId', 'e1');
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush([]);
    flushRoster(http);
    for (const peticion of http.match((p) => p.url === '/api/v1/events/e1/venues')) {
      peticion.flush([]);
    }
    http
      .expectOne((peticion) => peticion.url === '/api/v1/events/e1')
      .flush({ starts_at: '2026-10-01T08:00:00Z', ends_at: '2026-10-01T18:00:00Z' });
    await avanzar(fixture);

    const escribir = async (id: string, valor: string): Promise<void> => {
      const campo = fixture.nativeElement.querySelector(id) as HTMLInputElement;
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
      await avanzar(fixture);
    };
    const enviar = async (): Promise<void> => {
      (
        fixture.nativeElement.querySelector('app-session-form form') as HTMLFormElement
      ).dispatchEvent(new Event('submit'));
      await avanzar(fixture);
    };
    await escribir('#sesion-titulo', 'Al revés');
    const local = (iso: string): string => {
      const fecha = new Date(iso);
      return new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
    };
    await escribir('#sesion-inicio-nativo', local('2026-10-01T12:00:00Z'));
    await escribir('#sesion-fin-nativo', local('2026-10-01T11:00:00Z'));
    expect(fixture.nativeElement.textContent).toContain('El fin tiene que ser posterior al inicio');
    await enviar();
    http.expectNone((peticion) => peticion.method === 'POST');

    await escribir('#sesion-fin-nativo', local('2026-10-01T20:00:00Z'));
    await enviar();
    http.expectNone((peticion) => peticion.method === 'POST');
    expect(fixture.nativeElement.textContent).toContain('dentro de las fechas y horas del evento');
  });

  it('una sesión antigua fuera del evento se guarda si no se tocan sus fechas', async () => {
    const fixture = TestBed.createComponent(EventAgenda);
    fixture.componentRef.setInput('eventId', 'e1');
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
    flushRoster(http);
    for (const peticion of http.match((p) => p.url === '/api/v1/events/e1/venues')) {
      peticion.flush([]);
    }
    // El evento ya no cubre la sesión (2026-10-01): quedó fuera antes de la regla.
    http
      .expectOne((peticion) => peticion.url === '/api/v1/events/e1')
      .flush({ starts_at: '2027-01-01T08:00:00Z', ends_at: '2027-01-02T18:00:00Z' });
    await avanzar(fixture);

    (
      Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Editar',
      ) as HTMLButtonElement
    ).click();
    await avanzar(fixture);
    for (const peticion of http.match((p) => p.url === '/api/v1/events/e1/venues')) {
      peticion.flush([]);
    }
    http
      .expectOne((peticion) => peticion.url === '/api/v1/events/e1')
      .flush({ starts_at: '2027-01-01T08:00:00Z', ends_at: '2027-01-02T18:00:00Z' });
    await avanzar(fixture);
    const titulo = fixture.nativeElement.querySelector('#sesion-titulo') as HTMLInputElement;
    titulo.value = 'Charla renombrada';
    titulo.dispatchEvent(new Event('input'));
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('Tiene que estar entre');
    (fixture.nativeElement.querySelector('app-session-form form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await avanzar(fixture);

    http
      .expectOne((p) => p.url === '/api/v1/events/e1/sessions/s1' && p.method === 'PATCH')
      .flush({ ...sesiones()[0], title: 'Charla renombrada' });
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
    await avanzar(fixture);
    // Vuelve el formulario de alta, con sus propias peticiones.
    flushVenues(http);
  });

  it('editar rellena el formulario con la sesión y guarda contra su id', async () => {
    const fixture = TestBed.createComponent(EventAgenda);
    fixture.componentRef.setInput('eventId', 'e1');
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
    flushRoster(http);
    flushVenues(http);
    await avanzar(fixture);

    const botonEditar = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Editar',
    ) as HTMLButtonElement | undefined;
    expect(botonEditar).toBeTruthy();
    botonEditar?.click();
    await avanzar(fixture);
    // El formulario en línea pide sus sedes y los límites del evento al montarse.
    flushVenues(http);
    await avanzar(fixture);

    // El formulario es otro componente desde la partición: lo que se comprueba
    // es que recibe la sesión y se rellena, que es lo que estaba en riesgo.
    // El `<app-input>` proyecta el `<input>` real, y su `id` sale del `fieldId`.
    const titulo = fixture.nativeElement.querySelector('#sesion-titulo') as HTMLInputElement;
    expect(titulo.value).toBe('Charla de apertura');
    const sala = fixture.nativeElement.querySelector('#sesion-sala') as HTMLInputElement;
    expect(sala.value).toBe('Sala A');

    (fixture.nativeElement.querySelector('app-session-form form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await avanzar(fixture);

    const peticion = http.expectOne(
      (peticion) => peticion.url === '/api/v1/events/e1/sessions/s1' && peticion.method === 'PATCH',
    );
    expect(peticion.request.body.title).toBe('Charla de apertura');
    peticion.flush({ ...sesiones()[0] });
    await avanzar(fixture);

    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
    await avanzar(fixture);
    // Al terminar la edición vuelve el formulario de alta, con sus peticiones.
    flushVenues(http);
  });

  it('«Editar» abre el formulario bajo su sesión y oculta el de alta', async () => {
    const fixture = TestBed.createComponent(EventAgenda);
    fixture.componentRef.setInput('eventId', 'e1');
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events/e1/sessions').flush(sesiones());
    flushRoster(http);
    flushVenues(http);
    await avanzar(fixture);
    expect(fixture.nativeElement.querySelectorAll('app-session-form').length).toBe(1);

    (
      Array.from(fixture.nativeElement.querySelectorAll('button')).find(
        (boton) => (boton as HTMLButtonElement).textContent?.trim() === 'Editar',
      ) as HTMLButtonElement
    ).click();
    await avanzar(fixture);
    flushVenues(http);
    await avanzar(fixture);

    const formularios = fixture.nativeElement.querySelectorAll('app-session-form');
    expect(formularios.length).toBe(1);
    expect(formularios[0].closest('li')).not.toBeNull();
  });
});
