import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import es from '../../../../../public/assets/i18n/es-ES.json';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import { elegirEnSelect, valorDeSelect } from '../../../../testing/select';
import { EventReminderSettings } from './event-reminder-settings';

function crear(entradas: { dePago?: boolean; horas?: number | null; activado?: boolean } = {}) {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { 'es-ES': es },
        translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
      }),
    ],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(EventReminderSettings);
  fixture.componentRef.setInput('dePago', entradas.dePago ?? false);
  if (entradas.horas !== undefined) fixture.componentRef.setInput('horas', entradas.horas);
  if (entradas.activado !== undefined) fixture.componentRef.setInput('activado', entradas.activado);
  return fixture;
}

describe('EventReminderSettings', () => {
  it('en un evento nuevo muestra 1 día antes, y 2 días si es de pago', async () => {
    const gratis = crear();
    await gratis.whenStable();
    expect(valorDeSelect(gratis, 'evento-recordatorio-horas')).toBe('24');
    expect(gratis.nativeElement.querySelector('legend')?.textContent).toContain(
      'Recordatorio a los inscritos',
    );
    await esperarSinViolacionesDeAccesibilidad(gratis.nativeElement);

    TestBed.resetTestingModule();
    const dePago = crear({ dePago: true });
    await dePago.whenStable();
    expect(valorDeSelect(dePago, 'evento-recordatorio-horas')).toBe('48');
  });

  it('elegir unas horas las fija como número', async () => {
    const fixture = crear();
    await fixture.whenStable();

    elegirEnSelect(fixture, 'evento-recordatorio-horas', '6');
    await fixture.whenStable();

    expect(fixture.componentInstance.horas()).toBe(6);
  });

  it('con la casilla apagada el desplegable queda desactivado', async () => {
    const fixture = crear({ activado: false });
    await fixture.whenStable();

    const nativo = fixture.nativeElement.querySelector(
      '#evento-recordatorio-horas-nativo',
    ) as HTMLSelectElement;
    expect(nativo.disabled).toBe(true);
  });

  it('avisa en eventos de pago si el recordatorio llega sin plazo de reembolso', async () => {
    const fixture = crear({ dePago: true, horas: 24 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('ya ha pasado el plazo de reembolso');

    fixture.componentRef.setInput('horas', 48);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('ya ha pasado el plazo de reembolso');
  });
});
