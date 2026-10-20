import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import es from '../../../../../../public/assets/i18n/es-ES.json';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../../testing/axe';
import { EventNearbySection } from './event-nearby-section';

const SITIOS = [
  {
    kind: 'parking',
    custom_kind: null,
    name: 'Parking Centro',
    address: 'Calle Mayor 2',
    phone: '+34 961 23 45 67',
    website: 'https://www.parking.example/plazas',
    notes: 'Abierto 24 h',
  },
  {
    kind: 'hotel',
    custom_kind: null,
    name: 'Hotel Mar',
    address: null,
    phone: null,
    website: null,
    notes: null,
  },
  {
    kind: 'other',
    custom_kind: 'Gimnasio',
    name: 'Gym 24h',
    address: null,
    phone: null,
    website: null,
    notes: null,
  },
] as const;

describe('EventNearbySection', () => {
  it('agrupa por tipo, enlaza teléfono, web y mapa, y es accesible', async () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(EventNearbySection);
    fixture.componentRef.setInput('sitios', SITIOS);
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;

    const grupos = Array.from(raiz.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(grupos).toEqual(['Hotel', 'Parking', 'Otros']);
    expect(raiz.textContent).toContain('Gimnasio');
    const tel = raiz.querySelector('a[href^="tel:"]') as HTMLAnchorElement;
    expect(tel.getAttribute('href')).toBe('tel:+34961234567');
    const web = raiz.querySelector('a[rel~="nofollow"]') as HTMLAnchorElement;
    expect(web.textContent?.trim()).toBe('parking.example');
    expect(web.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    const mapa = raiz.querySelector('a[href*="maps/search"]') as HTMLAnchorElement;
    expect(new URL(mapa.href).searchParams.get('query')).toBe('Parking Centro, Calle Mayor 2');
    await esperarSinViolacionesDeAccesibilidad(raiz);
  });
});
