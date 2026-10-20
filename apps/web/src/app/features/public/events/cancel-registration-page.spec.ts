import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CancelRegistrationPage } from './cancel-registration-page';
import { RegistrationsService } from '../../../core/registrations/registrations.service';
import { ThemingService } from '../../../core/theming/theming.service';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';
import { themingDePrueba } from '../../../../testing/theming.fixture';

/** Mismo doble mínimo que `layouts/shells.spec.ts`: sin él, `AuthFrame`
 * inyectaría el `ThemingService` real, que necesita `HttpClient`. */

function rutaConToken(token: string | null) {
  return { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } };
}

describe('CancelRegistrationPage', () => {
  function configurar(registrations: Partial<RegistrationsService>, ruta: unknown) {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RegistrationsService, useValue: registrations },
        { provide: ActivatedRoute, useValue: ruta },
        { provide: ThemingService, useValue: themingDePrueba() },
      ],
    }).compileComponents();
  }

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('en el servidor no consume el token y pinta el estado de comprobación', () => {
    const cancel = vi.fn();
    const previewCancel = vi.fn();
    configurar({ cancel, previewCancel }, rutaConToken('token-de-un-solo-uso'));
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const fixture = TestBed.createComponent(CancelRegistrationPage);
    fixture.detectChanges();

    expect(cancel).not.toHaveBeenCalled();
    expect(previewCancel).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Comprobando el enlace');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it('sin token en la URL muestra el error y no tiene violaciones de accesibilidad', async () => {
    configurar({ cancel: vi.fn() }, rutaConToken(null));

    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('no es válido o ha caducado');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('sin token en la URL muestra el error en tema claro sin violaciones', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    configurar({ cancel: vi.fn() }, rutaConToken(null));

    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  const VISTA = {
    status: 'confirmed',
    event_title: 'Jornada de IA',
    starts_at: '2026-11-10T17:00:00Z',
    timezone: 'Europe/Madrid',
    already_started: false,
    refund: null,
  };

  it('al abrir el enlace no cancela: enseña el evento y pide confirmación', async () => {
    const cancel = vi.fn();
    const previewCancel = vi.fn().mockResolvedValue(VISTA);
    configurar({ cancel, previewCancel }, rutaConToken('token-valido'));

    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(previewCancel).toHaveBeenCalledWith('token-valido');
    expect(cancel).not.toHaveBeenCalled();
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Jornada de IA');
    // En la zona del evento: 17:00 UTC son las 18:00 en Madrid en noviembre.
    expect(texto).toContain('18:00');
    expect(texto).toContain('Sí, cancelar mi inscripción');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('al confirmar cancela y muestra el mensaje de la API', async () => {
    const cancel = vi.fn().mockResolvedValue({ message: 'Tu inscripción ha sido cancelada.' });
    configurar(
      { cancel, previewCancel: vi.fn().mockResolvedValue(VISTA) },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('app-button button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(cancel).toHaveBeenCalledWith('token-valido');
    expect(fixture.nativeElement.textContent).toContain('Tu inscripción ha sido cancelada.');
  });

  it('avisa de si se devolvería el pago', async () => {
    configurar(
      {
        cancel: vi.fn(),
        previewCancel: vi.fn().mockResolvedValue({ ...VISTA, refund: 'sin_reembolso' }),
      },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('no se devuelve el importe');
  });

  it('con el evento ya empezado no ofrece cancelar', async () => {
    configurar(
      {
        cancel: vi.fn(),
        previewCancel: vi.fn().mockResolvedValue({ ...VISTA, already_started: true }),
      },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('El evento ya ha empezado');
    expect(fixture.nativeElement.querySelector('app-button')).toBeNull();
  });

  it('si la inscripción ya estaba cancelada lo dice sin ofrecer el botón', async () => {
    configurar(
      {
        cancel: vi.fn(),
        previewCancel: vi.fn().mockResolvedValue({ ...VISTA, status: 'cancelled' }),
      },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('ya estaba cancelada');
    expect(fixture.nativeElement.querySelector('app-button')).toBeNull();
  });

  it('con un token caducado muestra el error genérico', async () => {
    const previewCancel = vi.fn().mockRejectedValue(new Error('caducado'));
    configurar({ cancel: vi.fn(), previewCancel }, rutaConToken('token-caducado'));

    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    const zonaAnuncio = fixture.nativeElement.querySelector('[aria-live="polite"]');
    expect(zonaAnuncio?.textContent).toContain('no es válido o ha caducado');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('si al confirmar el evento ya ha empezado lo dice y mueve el foco al aviso', async () => {
    const { ApiError } = await import('../../../core/api/error.interceptor');
    const cancel = vi.fn().mockRejectedValue(new ApiError(409, 'Ya ha empezado', null));
    configurar(
      { cancel, previewCancel: vi.fn().mockResolvedValue(VISTA) },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('app-button button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await new Promise((resolver) => setTimeout(resolver));

    expect(fixture.nativeElement.textContent).toContain('El evento ya ha empezado');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.resultado'));
  });

  it('si al confirmar falla otra cosa muestra el error genérico', async () => {
    configurar(
      {
        cancel: vi.fn().mockRejectedValue(new Error('red')),
        previewCancel: vi.fn().mockResolvedValue(VISTA),
      },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    (fixture.nativeElement.querySelector('app-button button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('no es válido o ha caducado');
  });

  it('anuncia que se devolverá el pago cuando procede', async () => {
    configurar(
      {
        cancel: vi.fn(),
        previewCancel: vi.fn().mockResolvedValue({ ...VISTA, refund: 'en_curso' }),
      },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Se te devolverá el importe');
  });

  it('en lista de espera no habla de liberar una plaza que no tiene', async () => {
    configurar(
      {
        cancel: vi.fn(),
        previewCancel: vi.fn().mockResolvedValue({ ...VISTA, status: 'waitlisted' }),
      },
      rutaConToken('token-valido'),
    );
    const fixture = TestBed.createComponent(CancelRegistrationPage);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Tu plaza quedará libre');
    expect(fixture.nativeElement.textContent).toContain('Sí, cancelar mi inscripción');
  });
});
