import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { ApiError } from '../../../core/api/error.interceptor';
import { AuthService } from '../../../core/auth/auth.service';
import {
  type MyRegistrationItem,
  RegistrationsService,
} from '../../../core/registrations/registrations.service';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { Reveal } from '../../../shared/ui/reveal.directive';
import { TurnstileWidget } from '../../../shared/ui/turnstile-widget';
import { MisEventosListado } from './mis-eventos-listado';

/** `comprobando` mientras se averigua si hay sesión; `cuenta`, el listado del
 * correo de la cuenta; `formulario`, el magic-link de siempre. */
type Modo = 'comprobando' | 'cuenta' | 'formulario';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Mis eventos». Con la sesión iniciada y el correo verificado, lista
 * directamente las inscripciones de ese correo. Si no, el formulario de un
 * campo (email) que pide el magic-link. Solo cliente (`app.routes.server.ts`):
 * la sesión vive en una cookie que el servidor no maneja, y pintar ahí el
 * formulario para cambiarlo luego por el listado haría parpadear la página.
 *
 * Con sesión pero el correo sin verificar (403 fuera de una suplantación), se
 * avisa encima del formulario en vez de caer a él sin explicación.
 *
 * La respuesta es siempre la misma exista o no ese email entre las
 * inscripciones (anti-enumeración, igual que `ForgotPasswordPage`): el
 * mensaje de éxito nunca distingue ambos casos, ni siquiera en el frontend —
 * la decisión de no enumerar es también de UI, no solo de API.
 */
@Component({
  selector: 'app-mis-eventos-solicitar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, Alert, Button, Input, Reveal, TurnstileWidget, MisEventosListado],
  template: `
    <ng-container *transloco="let t">
      <div class="ancho-maximo envoltura" appReveal>
        <h1>{{ t('publico.misEventos.titulo') }}</h1>

        @if (modo() === 'comprobando') {
          <app-alert tone="info">{{ t('publico.misEventos.cargando') }}</app-alert>
        } @else if (modo() === 'cuenta') {
          <app-mis-eventos-listado [inscripciones]="inscripciones()" />
        } @else if (enviado()) {
          <app-alert tone="exito" [title]="t('publico.misEventos.exitoTitulo')">
            {{ t('publico.misEventos.exitoDetalle') }}
          </app-alert>
        } @else {
          @if (correoSinVerificar()) {
            <app-alert tone="info">{{ t('publico.misEventos.correoSinVerificar') }}</app-alert>
          }
          <form (submit)="enviar($event)" novalidate>
            <p>{{ t('publico.misEventos.instrucciones') }}</p>
            <app-input
              [label]="t('publico.misEventos.email')"
              type="email"
              autocomplete="email"
              [required]="true"
              [error]="errorEmail()"
              [(value)]="email"
            />
            <app-turnstile-widget (resuelto)="turnstileToken.set($event)" />
            @if (error(); as mensaje) {
              <app-alert tone="error">{{ mensaje }}</app-alert>
            }
            <app-button type="submit" [loading]="enviando()">
              {{ enviando() ? t('publico.misEventos.enviando') : t('publico.misEventos.enviar') }}
            </app-button>
          </form>
        }
      </div>
    </ng-container>
  `,
  styles: `
    .envoltura {
      display: grid;
      gap: var(--space-md);
      padding: var(--space-lg) 0;
    }
    form {
      max-width: 26rem;
      display: grid;
      gap: var(--space-md);
    }
  `,
})
export class MisEventosSolicitarPage {
  private readonly registrations = inject(RegistrationsService);
  private readonly transloco = inject(TranslocoService);
  private readonly auth = inject(AuthService);

  protected readonly modo = signal<Modo>('comprobando');
  protected readonly inscripciones = signal<readonly MyRegistrationItem[]>([]);
  protected readonly correoSinVerificar = signal(false);

  protected readonly email = signal('');
  protected readonly errorEmail = signal<string | null>(null);
  protected readonly turnstileToken = signal<string | null>(null);
  protected readonly enviando = signal(false);
  protected readonly enviado = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.cargarDeLaCuenta();
  }

  private async cargarDeLaCuenta(): Promise<void> {
    const conSesion = this.auth.isAuthenticated() || (await this.auth.refresh());
    if (!conSesion) {
      this.modo.set('formulario');
      return;
    }
    try {
      this.inscripciones.set(await this.registrations.getMyAccountRegistrations());
      this.modo.set('cuenta');
    } catch (error) {
      this.correoSinVerificar.set(
        error instanceof ApiError && error.status === 403 && this.auth.suplantando() === null,
      );
      this.modo.set('formulario');
    }
  }

  protected async enviar(evento: Event): Promise<void> {
    evento.preventDefault();
    this.error.set(null);
    const correo = this.email().trim();
    this.errorEmail.set(
      EMAIL_RE.test(correo) ? null : this.transloco.translate('registro.emailInvalido'),
    );
    if (this.errorEmail()) {
      return;
    }

    this.enviando.set(true);
    try {
      await this.registrations.requestMisEventosAccess(correo, this.turnstileToken() ?? '');
      this.enviado.set(true);
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : this.transloco.translate('publico.misEventos.error'),
      );
    } finally {
      this.enviando.set(false);
    }
  }
}
