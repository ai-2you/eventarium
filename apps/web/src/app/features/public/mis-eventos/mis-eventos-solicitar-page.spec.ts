import { Component, provideZonelessChangeDetection, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MisEventosSolicitarPage } from './mis-eventos-solicitar-page';
import { ApiError } from '../../../core/api/error.interceptor';
import { AuthService } from '../../../core/auth/auth.service';
import { RegistrationsService } from '../../../core/registrations/registrations.service';
import { TurnstileWidget } from '../../../shared/ui/turnstile-widget';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';

/** Mismo doble que `forgot-password-page.spec.ts`: sin él, el widget real
 * intentaría cargar el script de Turnstile. */
@Component({ selector: 'app-turnstile-widget', template: '' })
class TurnstileWidgetFalso {
  readonly resuelto = output<string>();
}

describe('MisEventosSolicitarPage', () => {
  let auth: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    suplantando: ReturnType<typeof vi.fn>;
  };
  let getMyAccountRegistrations: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    auth = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      refresh: vi.fn().mockResolvedValue(false),
      suplantando: vi.fn().mockReturnValue(null),
    };
    getMyAccountRegistrations = vi.fn().mockResolvedValue([]);
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
        { provide: AuthService, useValue: auth },
        {
          provide: RegistrationsService,
          useValue: {
            requestMisEventosAccess: vi.fn().mockResolvedValue({ message: 'ok' }),
            getMyAccountRegistrations,
          },
        },
      ],
    })
      .overrideComponent(MisEventosSolicitarPage, {
        remove: { imports: [TurnstileWidget] },
        add: { imports: [TurnstileWidgetFalso] },
      })
      .compileComponents();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('no tiene violaciones de accesibilidad', async () => {
    const fixture = TestBed.createComponent(MisEventosSolicitarPage);
    await fixture.whenStable();
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('exige un correo válido y no envía la solicitud si falta', async () => {
    const fixture = TestBed.createComponent(MisEventosSolicitarPage);
    await fixture.whenStable();
    const registrations = TestBed.inject(RegistrationsService);

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();

    expect(registrations.requestMisEventosAccess).not.toHaveBeenCalled();
  });

  it('con un correo válido pide el enlace y muestra el mismo mensaje siempre', async () => {
    const fixture = TestBed.createComponent(MisEventosSolicitarPage);
    await fixture.whenStable();
    const registrations = TestBed.inject(RegistrationsService);

    const campoEmail = fixture.nativeElement.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    campoEmail.value = 'valido@example.com';
    campoEmail.dispatchEvent(new Event('input'));

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();

    expect(registrations.requestMisEventosAccess).toHaveBeenCalledWith('valido@example.com', '');
    expect(fixture.nativeElement.textContent).toContain('Revisa tu correo');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  describe('con la sesión iniciada', () => {
    it('lista las inscripciones de la cuenta sin pedir el correo', async () => {
      auth.isAuthenticated.mockReturnValue(true);
      getMyAccountRegistrations.mockResolvedValue([]);
      const fixture = TestBed.createComponent(MisEventosSolicitarPage);
      await fixture.whenStable();

      expect(getMyAccountRegistrations).toHaveBeenCalledOnce();
      expect(fixture.nativeElement.querySelector('form')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-mis-eventos-listado')).not.toBeNull();
    });

    it('recupera la sesión tras una recarga antes de decidir', async () => {
      auth.refresh.mockResolvedValue(true);
      const fixture = TestBed.createComponent(MisEventosSolicitarPage);
      await fixture.whenStable();

      expect(auth.refresh).toHaveBeenCalledOnce();
      expect(getMyAccountRegistrations).toHaveBeenCalledOnce();
    });

    it('sin sesión muestra el formulario y no pide el listado', async () => {
      const fixture = TestBed.createComponent(MisEventosSolicitarPage);
      await fixture.whenStable();

      expect(getMyAccountRegistrations).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    });

    it('con el correo sin verificar avisa encima del formulario', async () => {
      auth.isAuthenticated.mockReturnValue(true);
      getMyAccountRegistrations.mockRejectedValue(new ApiError(403, 'sin verificar', null));
      const fixture = TestBed.createComponent(MisEventosSolicitarPage);
      await fixture.whenStable();

      const texto = fixture.nativeElement.textContent as string;
      expect(texto).toContain(es.publico.misEventos.correoSinVerificar);
      expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    });

    it('durante una suplantación cae al formulario sin el aviso', async () => {
      auth.isAuthenticated.mockReturnValue(true);
      auth.suplantando.mockReturnValue({ usuario: 'x' });
      getMyAccountRegistrations.mockRejectedValue(new ApiError(403, 'suplantación', null));
      const fixture = TestBed.createComponent(MisEventosSolicitarPage);
      await fixture.whenStable();

      const texto = fixture.nativeElement.textContent as string;
      expect(texto).not.toContain(es.publico.misEventos.correoSinVerificar);
      expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    });
  });
});
