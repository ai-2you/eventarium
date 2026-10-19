import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/error.interceptor';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { ProfileField, validateDynamicFields } from '../../../shared/ui/dynamic-field.model';
import {
  DynamicFieldsList,
  type ErroresDePerfil,
  type ValoresDePerfil,
} from '../../../shared/ui/dynamic-fields-list';
import { ErrorSummary, ResumenDeError } from '../../../shared/ui/error-summary';

/** Lo que devuelve `PATCH /organizations/me/members/{id}/profile` y aquí importa. */
export interface FichaGuardada {
  readonly profile_data: Record<string, unknown>;
  readonly updated_at: string | null;
}

/**
 * Ficha de una membresía (la biografía de un ponente, p. ej.), con los campos
 * que define su rol. La usan la cuenta propia y el diálogo de Miembros: el
 * backend decide si quien guarda es el titular (exige los obligatorios) o quien
 * gestiona miembros (puede completarla por partes).
 */
@Component({
  selector: 'app-member-profile-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, Alert, Button, DynamicFieldsList, ErrorSummary],
  template: `
    <ng-container *transloco="let t">
      @if (campos().length === 0) {
        <p>{{ t('admin.members.ficha.sinCampos') }}</p>
      } @else {
        <form (submit)="guardar($event)" novalidate>
          <app-error-summary [errores]="resumenDeErrores()" [titulo]="t('comun.corrigeErrores')" />
          <app-dynamic-fields-list
            [prefijo]="prefijo()"
            [campos]="campos()"
            [exigirObligatorios]="exigirObligatorios()"
            [(valores)]="valores"
            [(errores)]="errores"
          />
          @if (exito()) {
            <app-alert tone="exito">{{ t('admin.members.ficha.exito') }}</app-alert>
          }
          @if (error(); as mensaje) {
            <app-alert tone="error">{{ mensaje }}</app-alert>
          }
          <div class="acciones">
            <app-button type="submit" [loading]="guardando()">
              {{ t('admin.members.ficha.guardar') }}
            </app-button>
          </div>
        </form>
      }
    </ng-container>
  `,
  styles: `
    form {
      display: grid;
      gap: var(--space-md);
    }
    .acciones {
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class MemberProfileForm {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService);

  readonly organizationMemberId = input.required<string>();
  readonly campos = input.required<readonly ProfileField[]>();
  readonly datos = input<Record<string, unknown>>({});
  readonly updatedAt = input<string | null>(null);
  /** Prefijo de los `id` de los controles: dos fichas en la misma página no chocan. */
  readonly prefijo = input('ficha');
  /** La API exige los obligatorios solo al titular; el diálogo de Miembros pasa `false`. */
  readonly exigirObligatorios = input(true);
  readonly guardado = output<FichaGuardada>();

  protected readonly valores = linkedSignal<ValoresDePerfil>(() => {
    const datos = this.datos();
    return Object.fromEntries(
      this.campos()
        .map((campo) => [campo.key, datos[campo.key]] as const)
        .filter(([, valor]) => typeof valor === 'string' || typeof valor === 'boolean'),
    ) as ValoresDePerfil;
  });
  protected readonly errores = signal<ErroresDePerfil>({});
  /** La versión leída: si otra persona guarda entre medias, la API responde 409. */
  private readonly version = linkedSignal(() => this.updatedAt());

  protected readonly guardando = signal(false);
  protected readonly exito = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly resumenDeErrores = computed<ResumenDeError[]>(() =>
    Object.entries(this.errores())
      .filter((entrada): entrada is [string, string] => Boolean(entrada[1]))
      .map(([clave, mensaje]) => ({ campoId: `${this.prefijo()}-${clave}`, mensaje })),
  );

  protected async guardar(evento: Event): Promise<void> {
    evento.preventDefault();
    this.error.set(null);
    this.exito.set(false);
    const errores = validateDynamicFields(this.campos(), this.valores(), {
      exigirObligatorios: this.exigirObligatorios(),
    });
    this.errores.set(errores);
    if (Object.values(errores).some(Boolean)) {
      return;
    }

    // Solo las claves que define hoy el rol: una heredada que siga guardada la
    // rechazaría la API como desconocida.
    const claves = new Set(this.campos().map((campo) => campo.key));
    const profileData = Object.fromEntries(
      Object.entries(this.valores()).filter(([clave]) => claves.has(clave)),
    );

    this.guardando.set(true);
    try {
      const ficha = await firstValueFrom(
        this.http.patch<FichaGuardada>(
          this.api.url(`/organizations/me/members/${this.organizationMemberId()}/profile`),
          { profile_data: profileData, expected_updated_at: this.version() },
        ),
      );
      this.version.set(ficha.updated_at);
      this.exito.set(true);
      this.guardado.emit(ficha);
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : this.transloco.translate('admin.members.ficha.error'),
      );
    } finally {
      this.guardando.set(false);
    }
  }
}
