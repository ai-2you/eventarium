import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';
import { By } from '@angular/platform-browser';
import { Select } from '../../../shared/ui/select';
import { EventScope } from '../../../layouts/admin/event-scope';
import { EventForm } from './event-form';

function eventoDetalle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    slug: 'iawic-2026',
    title: 'IA Week in Cascais 2026',
    summary: null,
    description: null,
    registration_mode: 'free',
    capacity: null,
    starts_at: '2026-10-01T09:00:00Z',
    ends_at: '2026-10-02T18:00:00Z',
    location_mode: 'in_person',
    timezone: 'Europe/Madrid',
    payment_checkout_window_minutes: 45,
    category: null,
    tags: [],
    ...overrides,
  };
}

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function configurar(id: string | null) {
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
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap(id ? { eventId: id } : {}) } },
      },
    ],
  });
}

const CATEGORIAS = [
  { id: 'c-taller', slug: 'taller', name: 'Taller', display_order: 1, is_active: true },
  { id: 'c-charla', slug: 'charla', name: 'Charla', display_order: 2, is_active: true },
];

/** El formulario pide el catálogo de categorías activas al abrirse. */
async function flushCategorias(
  http: HttpTestingController,
  fixture: ComponentFixture<unknown>,
  categorias: readonly object[] = CATEGORIAS,
): Promise<void> {
  http.expectOne('/api/v1/event-categories').flush(categorias);
  await avanzar(fixture);
}

/** `EventDetails` (delegado desde `EventForm` en modo edición) pide sus propios
 * datos —solo portada y estado, ya no arrastra ninguna sección del evento—: se
 * vacía aquí para no dejar la petición pendiente en `http.verify()`. */
async function flushEventDetails(
  http: HttpTestingController,
  fixture: ComponentFixture<unknown>,
): Promise<void> {
  http
    .expectOne((peticion) => peticion.url === '/api/v1/events/e1' && peticion.method === 'GET')
    .flush({ cover_url: null, status: 'draft' });
  await avanzar(fixture);
}

describe('EventForm', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
  });

  it('modo alta: sin violaciones de accesibilidad y sin pedir el evento ni delegar en EventDetails', async () => {
    configurar(null);
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EventForm);
    await avanzar(fixture);
    await flushCategorias(http, fixture);

    expect(fixture.nativeElement.querySelector('app-event-details')).toBeNull();
    const campoVentana = fixture.nativeElement.querySelector(
      '#evento-ventana-pago',
    ) as HTMLInputElement;
    expect(campoVentana.value).toBe('30');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
    // Una pasada de axe sobre este formulario ronda los 4 s en solitario y se
    // va más arriba con la suite en paralelo: el margen por defecto de 5 s
    // convierte la carga de la máquina en un fallo intermitente.
  }, 20_000);

  it('modo alta: 29 o 1440 minutos de ventana de pago se bloquean en el cliente', async () => {
    configurar(null);
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EventForm);
    await avanzar(fixture);
    await flushCategorias(http, fixture);

    const campoVentana = fixture.nativeElement.querySelector(
      '#evento-ventana-pago',
    ) as HTMLInputElement;
    campoVentana.value = '29';
    campoVentana.dispatchEvent(new Event('input'));
    campoVentana.dispatchEvent(new Event('blur'));
    await avanzar(fixture);

    expect(fixture.nativeElement.textContent).toContain('Debe estar entre 30 y 1439 minutos.');
  });

  it('modo edición: carga los datos base y delega el resto en EventDetails', async () => {
    configurar('e1');
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(EventForm);
    await avanzar(fixture);
    await flushCategorias(http, fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/events/e1' && peticion.method === 'GET')
      .flush(eventoDetalle());
    await avanzar(fixture);

    expect((fixture.nativeElement.querySelector('#evento-titulo') as HTMLInputElement).value).toBe(
      'IA Week in Cascais 2026',
    );
    expect(
      (fixture.nativeElement.querySelector('#evento-ventana-pago') as HTMLInputElement).value,
    ).toBe('45');
    expect(
      (fixture.nativeElement.querySelector('#evento-zona-horaria-nativo') as HTMLSelectElement)
        .value,
    ).toBe('Europe/Madrid');
    expect(fixture.nativeElement.querySelector('app-event-details')).not.toBeNull();

    await flushEventDetails(http, fixture);

    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  describe('categoría y etiquetas', () => {
    async function abrirEdicion(
      overrides: Record<string, unknown> = {},
      categorias: readonly object[] = CATEGORIAS,
    ) {
      configurar('e1');
      http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(EventForm);
      await avanzar(fixture);
      await flushCategorias(http, fixture, categorias);
      http
        .expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'GET')
        .flush(eventoDetalle(overrides));
      await avanzar(fixture);
      await flushEventDetails(http, fixture);
      return fixture;
    }

    function opciones(fixture: ComponentFixture<unknown>): string[] {
      const nativo = fixture.nativeElement.querySelector(
        '#evento-categoria-nativo',
      ) as HTMLSelectElement;
      return [...nativo.options].map((o) => o.textContent?.trim() ?? '');
    }

    it('ofrece «Sin categoría» y las activas del catálogo', async () => {
      const fixture = await abrirEdicion();
      expect(opciones(fixture)).toEqual(['Sin categoría', 'Taller', 'Charla']);
    });

    it('conserva en el selector la categoría actual aunque esté desactivada', async () => {
      const desactivada = {
        id: 'c-vieja',
        slug: 'vieja',
        name: 'Vieja',
        display_order: 9,
        is_active: false,
      };
      const fixture = await abrirEdicion({ category: desactivada });
      expect(opciones(fixture)).toContain('Vieja (desactivada)');
      expect(
        (fixture.nativeElement.querySelector('#evento-categoria-nativo') as HTMLSelectElement)
          .value,
      ).toBe('c-vieja');
    });

    it('carga las etiquetas y envía categoría y etiquetas normalizadas al guardar', async () => {
      const fixture = await abrirEdicion({ category: CATEGORIAS[0], tags: ['ia', 'datos'] });
      const campo = fixture.nativeElement.querySelector('#evento-etiquetas') as HTMLInputElement;
      expect(campo.value).toBe('ia, datos');

      campo.value = ' IA , Machine   Learning,ia ';
      campo.dispatchEvent(new Event('input'));
      await avanzar(fixture);
      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      await avanzar(fixture);

      const peticion = http.expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'PATCH');
      expect(peticion.request.body.category_id).toBe('c-taller');
      expect(peticion.request.body.tags).toEqual(['ia', 'machine learning']);
      peticion.flush(eventoDetalle());
    });

    it('«Sin categoría» envía null para quitarla', async () => {
      const fixture = await abrirEdicion({ category: CATEGORIAS[0] });
      // El `<select>` nativo del componente es un espejo oculto: se elige por el
      // propio componente, como haría un clic en su lista.
      const selector = fixture.debugElement
        .queryAll(By.directive(Select))
        .find((d) => d.nativeElement.querySelector('#evento-categoria-nativo'));
      selector?.componentInstance.value.set('');
      await avanzar(fixture);
      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      await avanzar(fixture);

      const peticion = http.expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'PATCH');
      expect(peticion.request.body.category_id).toBeNull();
      peticion.flush(eventoDetalle());
    });

    it('unas etiquetas inválidas se avisan y bloquean el guardado', async () => {
      const fixture = await abrirEdicion();
      const campo = fixture.nativeElement.querySelector('#evento-etiquetas') as HTMLInputElement;
      campo.value = 'uno, dos, tres, cuatro, cinco, seis';
      campo.dispatchEvent(new Event('input'));
      await avanzar(fixture);
      expect(fixture.nativeElement.textContent).toContain('como máximo 5 etiquetas');

      (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      await avanzar(fixture);
      http.expectNone((p) => p.method === 'PATCH');
    });
  });

  describe('resumen, descripción, modo de inscripción y aforo', () => {
    async function abrirEdicion(overrides: Record<string, unknown> = {}) {
      configurar('e1');
      http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(EventForm);
      await avanzar(fixture);
      await flushCategorias(http, fixture);
      http
        .expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'GET')
        .flush(eventoDetalle(overrides));
      await avanzar(fixture);
      await flushEventDetails(http, fixture);
      return fixture;
    }

    function campo<T extends HTMLElement>(fixture: ComponentFixture<unknown>, selector: string): T {
      return fixture.nativeElement.querySelector(selector) as T;
    }

    /** El `<select>` nativo de `app-select` es un espejo oculto: se elige por
     * el propio componente, como haría un clic en su lista. */
    function elegir(fixture: ComponentFixture<unknown>, id: string, valor: string): void {
      fixture.debugElement
        .queryAll(By.directive(Select))
        .find((d) => d.nativeElement.querySelector(`#${id}-nativo`))
        ?.componentInstance.value.set(valor);
    }

    async function enviar(fixture: ComponentFixture<unknown>): Promise<void> {
      campo<HTMLFormElement>(fixture, 'form').dispatchEvent(new Event('submit'));
      await avanzar(fixture);
    }

    it('carga los cuatro campos del evento', async () => {
      const fixture = await abrirEdicion({
        summary: 'Una semana de IA',
        description: 'Charlas y talleres.',
        registration_mode: 'approval',
        capacity: 120,
      });

      expect(campo<HTMLInputElement>(fixture, '#evento-resumen').value).toBe('Una semana de IA');
      expect(campo<HTMLTextAreaElement>(fixture, '#evento-descripcion').value).toBe(
        'Charlas y talleres.',
      );
      expect(campo<HTMLSelectElement>(fixture, '#evento-modo-inscripcion-nativo').value).toBe(
        'approval',
      );
      expect(campo<HTMLInputElement>(fixture, '#evento-aforo').value).toBe('120');
      expect(fixture.nativeElement.textContent).toContain('queda pendiente hasta que la apruebas');
    });

    it('envía los cambios y vacía con null lo que se borra', async () => {
      const fixture = await abrirEdicion({ description: 'Texto viejo', capacity: 50 });

      const descripcion = campo<HTMLTextAreaElement>(fixture, '#evento-descripcion');
      descripcion.value = '   ';
      descripcion.dispatchEvent(new Event('input'));
      const resumen = campo<HTMLInputElement>(fixture, '#evento-resumen');
      resumen.value = ' Resumen nuevo ';
      resumen.dispatchEvent(new Event('input'));
      elegir(fixture, 'evento-modo-inscripcion', 'paid');
      const aforo = campo<HTMLInputElement>(fixture, '#evento-aforo');
      aforo.value = '';
      aforo.dispatchEvent(new Event('input'));
      await avanzar(fixture);
      await enviar(fixture);

      const peticion = http.expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'PATCH');
      expect(peticion.request.body).toMatchObject({
        summary: 'Resumen nuevo',
        description: null,
        registration_mode: 'paid',
        capacity: null,
      });
      peticion.flush(eventoDetalle({ registration_mode: 'paid' }));
    });

    it('un aforo no entero o menor que uno bloquea el guardado', async () => {
      const fixture = await abrirEdicion();

      const aforo = campo<HTMLInputElement>(fixture, '#evento-aforo');
      aforo.value = '0';
      aforo.dispatchEvent(new Event('input'));
      await avanzar(fixture);
      await enviar(fixture);

      expect(fixture.nativeElement.textContent).toContain(
        'El aforo debe ser un número entero mayor que cero.',
      );
      http.expectNone((p) => p.method === 'PATCH');
    });

    it('un aforo con texto no numérico no se guarda como «sin límite»', async () => {
      const fixture = await abrirEdicion({ capacity: 50 });

      const aforo = campo<HTMLInputElement>(fixture, '#evento-aforo');
      Object.defineProperty(aforo, 'validity', { value: { badInput: true } });
      aforo.value = '';
      aforo.dispatchEvent(new Event('input'));
      await avanzar(fixture);
      await enviar(fixture);

      expect(fixture.nativeElement.textContent).toContain(
        'El aforo debe ser un número entero mayor que cero.',
      );
      http.expectNone((p) => p.method === 'PATCH');
    });

    it('tras guardar refresca el modo del evento en EventScope', async () => {
      const fixture = await abrirEdicion();
      const actualizar = vi.spyOn(TestBed.inject(EventScope), 'actualizar');

      elegir(fixture, 'evento-modo-inscripcion', 'paid');
      await avanzar(fixture);
      await enviar(fixture);
      http
        .expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'PATCH')
        .flush(eventoDetalle({ registration_mode: 'paid' }));
      await avanzar(fixture);

      expect(actualizar).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ registration_mode: 'paid' }),
      );
    });

    it('muestra el 409 de la API al cambiar el modo', async () => {
      const fixture = await abrirEdicion();
      elegir(fixture, 'evento-modo-inscripcion', 'paid');
      await avanzar(fixture);
      await enviar(fixture);
      http
        .expectOne((p) => p.url === '/api/v1/events/e1' && p.method === 'PATCH')
        .flush(
          { detail: 'No se puede pasar el evento a «de pago» porque ya tiene inscripciones.' },
          { status: 409, statusText: 'Conflict' },
        );
      await avanzar(fixture);

      expect(fixture.nativeElement.querySelector('app-alert')).not.toBeNull();
    });
  });
});
