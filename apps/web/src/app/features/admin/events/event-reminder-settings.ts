import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { Checkbox } from '../../../shared/ui/checkbox';
import { Select, type SelectOption } from '../../../shared/ui/select';

/** Mismo conjunto que `ReminderHours` en la API y el `CHECK` de base de datos. */
export const HORAS_DE_RECORDATORIO = [2, 6, 12, 24, 48, 72] as const;

/**
 * Recordatorio a los inscritos, dentro del formulario del evento: si se envía
 * y cuántas horas antes. `horas` es `null` mientras el organizador no elija
 * nada en un evento nuevo: la API pone entonces 24 h, o 48 h si es de pago
 * (a tiempo de cancelar con reembolso), y aquí se muestra ese mismo valor.
 */
@Component({
  selector: 'app-event-reminder-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, Checkbox, Select],
  template: `
    <ng-container *transloco="let t; read: 'admin.events.formulario.recordatorio'">
      <fieldset class="recordatorio">
        <legend>{{ t('titulo') }}</legend>
        <app-checkbox
          fieldId="evento-recordatorio"
          [label]="t('activar')"
          describedBy="evento-recordatorio-ayuda"
          [(checked)]="activado"
        />
        <app-select
          fieldId="evento-recordatorio-horas"
          [label]="t('cuando')"
          [options]="opciones()"
          [disabled]="!activado()"
          [value]="valorMostrado()"
          (valueChange)="horas.set(+$event)"
        />
        <p id="evento-recordatorio-ayuda" class="ayuda">{{ t('ayuda') }}</p>
        @if (avisoDePago()) {
          <p class="aviso" role="note">{{ t('avisoPago') }}</p>
        }
      </fieldset>
    </ng-container>
  `,
  styles: `
    .recordatorio {
      display: grid;
      gap: var(--space-sm);
      margin: 0;
      padding: var(--space-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    legend {
      padding: 0 var(--space-sm);
      font-weight: 600;
    }
    .ayuda,
    .aviso {
      margin: 0;
      font-size: 0.875rem;
      color: var(--muted);
    }
    .aviso {
      color: var(--fg);
    }
  `,
})
export class EventReminderSettings {
  readonly activado = model(true);
  readonly horas = model<number | null>(null);
  readonly dePago = input(false);

  private readonly transloco = inject(TranslocoService);

  protected readonly valorEfectivo = computed(() => this.horas() ?? (this.dePago() ? 48 : 24));
  protected readonly valorMostrado = computed(() => String(this.valorEfectivo()));

  protected readonly opciones = computed<SelectOption[]>(() =>
    HORAS_DE_RECORDATORIO.map((horas) => ({
      value: String(horas),
      label: this.transloco.translate(`admin.events.formulario.recordatorio.horas.${horas}`),
    })),
  );

  /** Con el plazo de reembolso de 24 h, un recordatorio a 24 h o menos llega
   * cuando ya no se devuelve el importe al cancelar. */
  protected readonly avisoDePago = computed(
    () => this.dePago() && this.activado() && this.valorEfectivo() <= 24,
  );
}
