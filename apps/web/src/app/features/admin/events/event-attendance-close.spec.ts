import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import es from '../../../../../public/assets/i18n/es-ES.json';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import { EventAttendanceClose } from './event-attendance-close';

const HACE_UN_DIA = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const MANANA = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function evento(overrides: Record<string, unknown> = {}) {
  return { ends_at: HACE_UN_DIA, can_close: true, attendance_closed_at: null, ...overrides };
}

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function pulsar(fixture: ComponentFixture<unknown>, texto: string): void {
  const boton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
    (b as HTMLElement).textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
  if (!boton) throw new Error(`No hay ningún botón «${texto}».`);
  boton.click();
}

describe('EventAttendanceClose', () => {
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

  async function abrir(datos: Record<string, unknown>) {
    const fixture = TestBed.createComponent(EventAttendanceClose);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.detectChanges();
    http.expectOne('/api/v1/events/e1/attendance').flush(evento(datos));
    await avanzar(fixture);
    return fixture;
  }

  it('antes de que termine el evento no aparece', async () => {
    const fixture = await abrir({ ends_at: MANANA });
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('si el evento no admite cierre (en línea, híbrido…) no aparece', async () => {
    const fixture = await abrir({ can_close: false });
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('tras el evento sugiere cerrarla y lo hace solo al confirmar', async () => {
    const fixture = await abrir({});
    expect(fixture.nativeElement.textContent).toContain('El evento ha terminado');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);

    pulsar(fixture, 'Cerrar asistencia');
    await avanzar(fixture);
    http.expectNone('/api/v1/events/e1/attendance/close');
    expect(fixture.nativeElement.textContent).toContain('¿Cerrar la asistencia?');

    pulsar(fixture, 'Sí, cerrar la asistencia');
    await avanzar(fixture);
    http
      .expectOne((p) => p.url === '/api/v1/events/e1/attendance/close' && p.method === 'POST')
      .flush(evento({ attendance_closed_at: new Date().toISOString() }));
    await avanzar(fixture);

    expect(fixture.nativeElement.textContent).toContain('Asistencia cerrada el');
    expect(fixture.nativeElement.textContent).toContain('Reabrir asistencia');
  });

  it('pasados 7 días del evento ya no ofrece reabrir', async () => {
    const fixture = await abrir({
      ends_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      attendance_closed_at: HACE_UN_DIA,
    });
    expect(fixture.nativeElement.textContent).toContain('Asistencia cerrada el');
    expect(fixture.nativeElement.textContent).not.toContain('Reabrir asistencia');
  });

  it('muestra el error de la API si no se puede cerrar', async () => {
    const fixture = await abrir({});
    pulsar(fixture, 'Cerrar asistencia');
    await avanzar(fixture);
    pulsar(fixture, 'Sí, cerrar la asistencia');
    await avanzar(fixture);
    http
      .expectOne('/api/v1/events/e1/attendance/close')
      .flush(
        { title: 'Conflicto', detail: 'No se puede cerrar.' },
        { status: 409, statusText: 'Conflict' },
      );
    await avanzar(fixture);

    expect(fixture.nativeElement.querySelector('app-alert')).not.toBeNull();
  });
});
