import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import es from '../../../../../public/assets/i18n/es-ES.json';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import { elegirEnSelect } from '../../../../testing/select';
import { EventNearbyPlaces } from './event-nearby-places';

const SITIO = {
  id: 'n1',
  kind: 'hotel',
  custom_kind: null,
  name: 'Hotel Mar',
  address: 'Paseo 3',
  phone: null,
  website: null,
  notes: null,
};

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('EventNearbyPlaces', () => {
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

  async function abrir(sitios: unknown[] = [SITIO]) {
    const fixture = TestBed.createComponent(EventNearbyPlaces);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.detectChanges();
    http.expectOne('/api/v1/events/e1/nearby-places').flush(sitios);
    http
      .expectOne((p) => p.url === '/api/v1/events')
      .flush({
        items: [
          { id: 'e1', title: 'Este' },
          { id: 'e0', title: 'Edición 2025' },
        ],
      });
    await avanzar(fixture);
    return fixture;
  }

  it('lista los sitios y ofrece copiar de otro evento, sin violaciones', async () => {
    const fixture = await abrir();
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Hotel Mar');
    expect(texto).toContain('Copiar de otro evento');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('pide el tipo libre solo con «Otro» y lo envía al añadir', async () => {
    const fixture = await abrir([]);
    expect(fixture.nativeElement.querySelector('#cercano-tipo-libre')).toBeNull();
    elegirEnSelect(fixture, 'cercano-tipo', 'other');
    await avanzar(fixture);
    expect(fixture.nativeElement.querySelector('#cercano-tipo-libre')).not.toBeNull();

    for (const [id, valor] of [
      ['cercano-tipo-libre', 'Gimnasio'],
      ['cercano-nombre', 'Gym 24h'],
    ]) {
      const campo = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
    }
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await avanzar(fixture);

    const alta = http.expectOne((p) => p.method === 'POST');
    expect(alta.request.body).toMatchObject({
      kind: 'other',
      custom_kind: 'Gimnasio',
      name: 'Gym 24h',
      phone: null,
    });
    alta.flush({ ...SITIO, id: 'n2' });
    await avanzar(fixture);
    http.expectOne('/api/v1/events/e1/nearby-places').flush([]);
  });

  it('copia los sitios del evento elegido', async () => {
    const fixture = await abrir([]);
    elegirEnSelect(fixture, 'cercanos-copiar-de', 'e0');
    await avanzar(fixture);
    const boton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('Copiar sus sitios'),
    ) as HTMLButtonElement;
    boton.click();
    await avanzar(fixture);

    http.expectOne('/api/v1/events/e1/nearby-places/copy-from/e0').flush([SITIO]);
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).toContain('Hotel Mar');
  });
});
