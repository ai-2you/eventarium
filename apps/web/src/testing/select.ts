import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Select } from '../app/shared/ui/select';

/** El `<select>` nativo de `app-select` es un espejo oculto que no propaga
 * cambios: en los specs se elige por el propio componente, como haría un clic
 * en su lista. `fieldId` es el `fieldId` del `app-select`. */
export function elegirEnSelect(
  fixture: ComponentFixture<unknown>,
  fieldId: string,
  valor: string,
): void {
  const selector = fixture.debugElement
    .queryAll(By.directive(Select))
    .find((d) => d.nativeElement.querySelector(`#${fieldId}-nativo`));
  if (!selector) {
    throw new Error(`No hay ningún app-select con fieldId «${fieldId}».`);
  }
  (selector.componentInstance as Select).value.set(valor);
}

/** Valor elegido en un `app-select`, leído de su espejo nativo. */
export function valorDeSelect(fixture: ComponentFixture<unknown>, fieldId: string): string {
  const nativo = fixture.nativeElement.querySelector(`#${fieldId}-nativo`) as HTMLSelectElement;
  return nativo.value;
}
