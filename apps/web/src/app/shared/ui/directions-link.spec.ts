import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import es from '../../../../public/assets/i18n/es-ES.json';
import { esperarSinViolacionesDeAccesibilidad } from '../../../testing/axe';
import { DirectionsLink } from './directions-link';

function crear(entradas: Record<string, unknown>) {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { 'es-ES': es },
        translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
      }),
    ],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(DirectionsLink);
  for (const [clave, valor] of Object.entries(entradas)) {
    fixture.componentRef.setInput(clave, valor);
  }
  return fixture;
}

describe('DirectionsLink', () => {
  it('lleva a la ruta en Google Maps con el lugar y la dirección en texto', async () => {
    const fixture = crear({ lugar: 'Las Naves', direccion: 'Calle Mayor 1, Valencia' });
    await fixture.whenStable();

    const enlace = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    const url = new URL(enlace.href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('Las Naves, Calle Mayor 1, Valencia');
    expect(enlace.target).toBe('_blank');
    expect(enlace.getAttribute('aria-label')).toContain('Cómo llegar a Las Naves');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('sin dirección usa las coordenadas, y sin nada no pinta el enlace', async () => {
    const conCoordenadas = crear({ latitud: 39.47, longitud: -0.37 });
    await conCoordenadas.whenStable();
    const href = (conCoordenadas.nativeElement.querySelector('a') as HTMLAnchorElement).href;
    expect(new URL(href).searchParams.get('destination')).toBe('39.47,-0.37');

    TestBed.resetTestingModule();
    const vacio = crear({ lugar: 'Sin dirección' });
    await vacio.whenStable();
    expect(vacio.nativeElement.querySelector('a')).toBeNull();
  });

  it('no repite el lugar si ya va en la dirección', async () => {
    const fixture = crear({ lugar: 'Valencia', direccion: 'Calle Mayor 1, Valencia' });
    await fixture.whenStable();
    const href = (fixture.nativeElement.querySelector('a') as HTMLAnchorElement).href;
    expect(new URL(href).searchParams.get('destination')).toBe('Calle Mayor 1, Valencia');
  });
});
