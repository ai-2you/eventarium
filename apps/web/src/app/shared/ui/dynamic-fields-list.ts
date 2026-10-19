import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

import { DynamicField } from './dynamic-field';
import { ProfileField, validateDynamicFieldValue } from './dynamic-field.model';

export type ValoresDePerfil = Partial<Record<string, string | boolean>>;
export type ErroresDePerfil = Partial<Record<string, string | null>>;

/**
 * Los campos de perfil de un rol, uno tras otro. Reúne valores y errores por
 * clave y valida cada campo al salir de él; validar todo antes de enviar es
 * cosa de quien lo usa (`validateDynamicFields`), que es quien sabe cuándo.
 */
@Component({
  selector: 'app-dynamic-fields-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DynamicField],
  template: `
    @for (campo of campos(); track campo.key) {
      <app-dynamic-field
        [fieldId]="prefijo() + '-' + campo.key"
        [field]="campo"
        [error]="errores()[campo.key] ?? null"
        [value]="valores()[campo.key] ?? ''"
        (valueChange)="actualizar(campo.key, $event)"
        (blurred)="validar(campo)"
      />
    }
  `,
})
export class DynamicFieldsList {
  readonly campos = input.required<readonly ProfileField[]>();
  /** Prefijo de los `id` de los controles, para que el resumen de errores enlace. */
  readonly prefijo = input('perfil');
  /** `false` para quien completa una ficha ajena por partes (ver `validateDynamicFieldValue`). */
  readonly exigirObligatorios = input(true);
  readonly valores = model<ValoresDePerfil>({});
  readonly errores = model<ErroresDePerfil>({});

  protected actualizar(clave: string, valor: string | boolean): void {
    this.valores.update((actuales) => ({ ...actuales, [clave]: valor }));
  }

  protected validar(campo: ProfileField): void {
    const error = validateDynamicFieldValue(campo, this.valores()[campo.key] ?? '', {
      exigirObligatorios: this.exigirObligatorios(),
    });
    this.errores.update((actuales) => ({ ...actuales, [campo.key]: error }));
  }
}
