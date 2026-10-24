import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';
import { EventsPage } from './events-page';
import { elegirEnSelect } from '../../../../testing/select';

function pagina() {
  return {
    items: [
      {
        id: 'e1',
        slug: 'iawic-2026',
        title: 'IA Week in Cascais 2026',
        status: 'draft',
        starts_at: '2026-10-01T09:00:00Z',
        registration_mode: 'free',
        capacity: null,
      },
    ],
  };
}

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('EventsPage', () => {
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

  it('lista los eventos y no tiene violaciones de accesibilidad', async () => {
    const fixture = TestBed.createComponent(EventsPage);
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events').flush(pagina());
    await avanzar(fixture);

    expect(fixture.nativeElement.textContent).toContain('IA Week in Cascais 2026');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('marca los eventos «solo con enlace» y privados, no los públicos', async () => {
    const fixture = TestBed.createComponent(EventsPage);
    await avanzar(fixture);
    const [base] = pagina().items;
    http
      .expectOne((peticion) => peticion.url === '/api/v1/events')
      .flush({
        items: [
          { ...base, id: 'e1', visibility: 'hidden' },
          { ...base, id: 'e2', title: 'Privado', visibility: 'private' },
          { ...base, id: 'e3', title: 'Público', visibility: 'public' },
        ],
      });
    await avanzar(fixture);

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Solo con enlace');
    expect(texto).toContain('Privado');
    expect(texto.match(/Solo con enlace|Privado/g)?.length).toBe(3);
  });

  it('muestra el modo de inscripción, el precio y el aforo de cada evento', async () => {
    const fixture = TestBed.createComponent(EventsPage);
    await avanzar(fixture);
    const base = pagina().items[0]!;
    http
      .expectOne((peticion) => peticion.url === '/api/v1/events')
      .flush({
        items: [
          { ...base, id: 'libre' },
          { ...base, id: 'aprob', registration_mode: 'approval', capacity: 80 },
          {
            ...base,
            id: 'pago',
            registration_mode: 'paid',
            capacity: 120,
            price_from_cents: 1250,
            price_currency: 'eur',
            price_multiple: true,
          },
          { ...base, id: 'sin', registration_mode: 'paid', capacity: 10, price_from_cents: null },
        ],
      });
    await avanzar(fixture);

    const filas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ).map((fila) =>
      Array.from(fila.querySelectorAll('td'))
        .slice(2, 5)
        .map((celda) => celda.textContent?.replace(/\s+/g, ' ').trim()),
    );
    const previa = (fixture.nativeElement as HTMLElement).querySelector(
      'a.vista-previa',
    ) as HTMLAnchorElement;
    expect(previa.getAttribute('href')).toBe('/vista-previa/libre');
    expect(previa.getAttribute('target')).toBe('_blank');
    expect(filas).toEqual([
      ['Acceso libre', 'Gratis', 'Sin límite'],
      ['Con aprobación', 'Gratis', '80'],
      ['De pago', 'Desde 12,50 €', '120'],
      ['De pago', 'Sin entradas', '10'],
    ]);
  });

  it('la tabla usa app-data-table con caption, y el estado va en un chip con texto', async () => {
    const fixture = TestBed.createComponent(EventsPage);
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events').flush(pagina());
    await avanzar(fixture);

    const contenedor = fixture.nativeElement.querySelector('app-data-table') as HTMLElement | null;
    expect(contenedor).not.toBeNull();
    const tabla = contenedor!.querySelector('table') as HTMLTableElement;
    expect(tabla.querySelector('caption')?.textContent?.trim()).toBeTruthy();
    expect(tabla.querySelectorAll('th[scope="col"]').length).toBe(7);

    const ranura = contenedor!.querySelector('.ranura-scroll') as HTMLElement;
    expect(ranura.getAttribute('tabindex')).toBe('0');

    // El chip lleva el estado escrito: quitar el color no lo deja mudo.
    const chip = contenedor!.querySelector('app-chip .chip') as HTMLElement;
    expect(chip.textContent?.trim()).toBeTruthy();
    // El evento del fixture está en borrador, que el mapa de tonos marca como
    // «espera»: lo que importa es que el tono salga del estado, no que sea ok.
    expect(chip.getAttribute('class')).toContain('espera');
  });

  it('filtra por estado al cambiar el selector', async () => {
    const fixture = TestBed.createComponent(EventsPage);
    await avanzar(fixture);
    http.expectOne((peticion) => peticion.url === '/api/v1/events').flush(pagina());
    await avanzar(fixture);

    elegirEnSelect(fixture, 'filtro-estado', 'published');
    await avanzar(fixture);

    const peticion = http.expectOne((peticion) => peticion.url === '/api/v1/events');
    expect(peticion.request.params.get('status')).toBe('published');
    peticion.flush({ items: [] });
  });
  it('no tiene violaciones de accesibilidad en tema claro', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      const fixture = TestBed.createComponent(EventsPage);
      await avanzar(fixture);
      http.expectOne((peticion) => peticion.url === '/api/v1/events').flush(pagina());
      await avanzar(fixture);

      await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });
});
