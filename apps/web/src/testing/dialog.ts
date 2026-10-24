import { ComponentFixture } from '@angular/core/testing';

/** jsdom no implementa `showModal()`/`close()` del `<dialog>` nativo que usa
 * `app-dialog`: se emula con el atributo `open`. */
export function emularDialogoNativo(): void {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

/** Pulsa, dentro del `app-dialog` abierto, el botón cuyo texto contiene `texto`. */
export function pulsarEnDialogo(fixture: ComponentFixture<unknown>, texto: string): void {
  const dialogo = (fixture.nativeElement as HTMLElement).querySelector('dialog[open]');
  if (!dialogo) {
    throw new Error('No hay ningún diálogo abierto.');
  }
  const boton = Array.from(dialogo.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(texto),
  );
  if (!boton) {
    throw new Error(`El diálogo abierto no tiene ningún botón «${texto}».`);
  }
  boton.click();
}
