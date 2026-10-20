import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionTypesPage, type TipoDeSesion } from './session-types-page';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';

const URL = '/api/v1/organizations/me/session-types';

function tipo(id: string, nombre: string, extra: Partial<TipoDeSesion> = {}): TipoDeSesion {
  return {
    id,
    name: nombre,
    description: null,
    color: 'azul',
    is_break: false,
    base_key: null,
    display_order: 0,
    is_active: true,
    sesiones: 0,
    ...extra,
  };
}

const CATALOGO = [
  tipo('t1', 'Charla', { base_key: 'talk', sesiones: 4 }),
  tipo('t2', 'Descanso', { color: 'gris', is_break: true, base_key: 'break' }),
];

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function boton(fixture: ComponentFixture<unknown>, texto: string): HTMLButtonElement {
  const raiz = fixture.nativeElement as HTMLElement;
  // El `aria-label` de los botones de orden va en el `app-button` que lo envuelve.
  const etiquetado = raiz.querySelector(`[aria-label="${texto}"]`);
  if (etiquetado) {
    return (etiquetado.querySelector('button') ?? etiquetado) as HTMLButtonElement;
  }
  return Array.from(raiz.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === texto,
  )!;
}

describe('SessionTypesPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
    }
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

  async function montar(): Promise<ComponentFixture<SessionTypesPage>> {
    const fixture = TestBed.createComponent(SessionTypesPage);
    await avanzar(fixture);
    http.expectOne(URL).flush(CATALOGO);
    await avanzar(fixture);
    return fixture;
  }

  it('lista los tipos con sus usos y solo deja borrar el que no se usa', async () => {
    const fixture = await montar();
    const filas = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li'));

    expect(filas[0]!.textContent).toContain('Charla');
    expect(filas[0]!.textContent).toContain('4 sesión(es)');
    expect(filas[0]!.textContent).not.toContain('Borrar');
    expect(filas[1]!.textContent).toContain('Pausa');
    expect(filas[1]!.textContent).toContain('Borrar');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('crea un tipo con la ayuda de ejemplos a la vista', async () => {
    const fixture = await montar();
    boton(fixture, 'Nuevo tipo').click();
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).toContain(
      'Por ejemplo: Taller, Mesa redonda, Keynote',
    );

    const nombre = fixture.nativeElement.querySelector('#tipo-nombre') as HTMLInputElement;
    nombre.value = 'Mesa redonda';
    nombre.dispatchEvent(new Event('input'));
    const rosa = fixture.nativeElement.querySelector(
      'input[name="tipo-color"][value="rosa"]',
    ) as HTMLInputElement;
    rosa.dispatchEvent(new Event('change'));
    await avanzar(fixture);
    boton(fixture, 'Guardar').click();
    await avanzar(fixture);

    const alta = http.expectOne((p) => p.url === URL && p.method === 'POST');
    expect(alta.request.body).toEqual({
      name: 'Mesa redonda',
      description: null,
      color: 'rosa',
      is_break: false,
    });
    alta.flush(tipo('t3', 'Mesa redonda', { color: 'rosa' }));
    await avanzar(fixture);
    http.expectOne(URL).flush([...CATALOGO, tipo('t3', 'Mesa redonda', { color: 'rosa' })]);
    await avanzar(fixture);
  });

  it('sin nombre no envía nada', async () => {
    const fixture = await montar();
    boton(fixture, 'Nuevo tipo').click();
    await avanzar(fixture);
    boton(fixture, 'Guardar').click();
    await avanzar(fixture);

    http.expectNone((p) => p.method === 'POST');
    expect(fixture.nativeElement.textContent).toContain('Ponle un nombre al tipo');
  });

  it('bajar un tipo envía el orden completo', async () => {
    const fixture = await montar();
    boton(fixture, 'Bajar «Charla»').click();
    await avanzar(fixture);

    const orden = http.expectOne((p) => p.url === `${URL}/order` && p.method === 'PUT');
    expect(orden.request.body).toEqual({ ids: ['t2', 't1'] });
    orden.flush(null, { status: 204, statusText: 'No Content' });
    await avanzar(fixture);
    http.expectOne(URL).flush([CATALOGO[1], CATALOGO[0]]);
    await avanzar(fixture);
  });
});
