import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';

/** Lo que tarda en pedirse sugerencias tras la última pulsación. */
const ESPERA_SUGERENCIAS_MS = 200;

/**
 * Campo de etiquetas en píldoras: se escribe, la coma o Intro crea la píldora,
 * cada una se quita con su X y Retroceso con el campo vacío quita la última.
 * Mientras se escribe ofrece sugerencias (las aporta quien lo usa, a partir de
 * `buscar`), en una lista con el patrón combobox de `app-select`: flechas para
 * moverse, Intro para elegir, Escape para cerrar.
 *
 * Las reglas de cada etiqueta no viven aquí: `normalizar` y `validar` las pone
 * quien lo usa, para que el mismo componente sirva con otras reglas.
 */
@Component({
  selector: 'app-tags-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="campo">
      <label class="rotulo" [for]="idCampo()">{{ label() }}</label>
      <div class="caja" [class.invalida]="mensajeError()">
        <ul class="pildoras" [attr.aria-label]="label()">
          @for (etiqueta of value(); track etiqueta) {
            <li class="pildora">
              <span>{{ etiqueta }}</span>
              <button
                type="button"
                class="pildora__quitar"
                [attr.aria-label]="textoQuitar() + ' «' + etiqueta + '»'"
                [disabled]="disabled()"
                (click)="quitar(etiqueta); $event.stopPropagation()"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
                </svg>
              </button>
            </li>
          }
        </ul>
        <input
          type="text"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          [id]="idCampo()"
          [attr.aria-expanded]="listaAbierta()"
          [attr.aria-controls]="idLista()"
          [attr.aria-activedescendant]="indiceActivo() >= 0 ? idOpcion(indiceActivo()) : null"
          [attr.aria-invalid]="mensajeError() ? 'true' : null"
          [attr.aria-describedby]="descripcionId()"
          [disabled]="disabled()"
          [readOnly]="lleno()"
          [attr.aria-disabled]="lleno() ? 'true' : null"
          [placeholder]="lleno() ? '' : placeholder()"
          [value]="texto()"
          (input)="alEscribir($event)"
          (keydown)="alPulsarTecla($event)"
          (blur)="alSalir()"
        />
      </div>
      @if (listaAbierta()) {
        <ul class="sugerencias" role="listbox" [id]="idLista()" [attr.aria-label]="label()">
          @for (sugerencia of sugerenciasVisibles(); track sugerencia; let i = $index) {
            <!-- Mismo patrón que app-select: el teclado lo lleva el combobox
                 (aria-activedescendant); el clic es la vía de puntero. -->
            <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
            <li
              role="option"
              class="sugerencia"
              [id]="idOpcion(i)"
              [class.activa]="i === indiceActivo()"
              [attr.aria-selected]="i === indiceActivo()"
              (mousedown)="$event.preventDefault()"
              (click)="anadir(sugerencia)"
            >
              {{ sugerencia }}
            </li>
          }
        </ul>
      }
      @if (mensajeError(); as mensaje) {
        <p class="error" [id]="idError()">{{ mensaje }}</p>
      } @else if (hint()) {
        <p class="ayuda" [id]="idAyuda()">{{ hint() }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    /* Mismo hueco bajo el rótulo y misma altura de caja (48px con el borde)
     * que \`app-select\`: lado a lado en una fila, deben quedar a la par. */
    .campo {
      position: relative;
      display: grid;
      gap: var(--space-sm);
    }
    .rotulo {
      font-size: var(--fs-sm);
      font-weight: 500;
      color: var(--muted);
    }
    .caja {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      min-height: 3rem;
      padding: 6px 0.75rem;
      box-sizing: border-box;
      background: var(--surface-2);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      transition: border-color 0.15s;
    }
    .caja:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .caja.invalida {
      border-color: var(--danger);
    }
    .pildoras {
      display: contents;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .pildora {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 4px 2px 10px;
      border-radius: 999px;
      background: var(--surface-hi);
      color: var(--fg);
      font-size: var(--fs-sm);
      line-height: 1.6;
    }
    .pildora__quitar {
      display: grid;
      place-items: center;
      width: 1.375rem;
      height: 1.375rem;
      padding: 0;
      border: none;
      border-radius: 999px;
      background: none;
      color: var(--muted);
      cursor: pointer;
    }
    .pildora__quitar:hover {
      background: var(--surface);
      color: var(--fg);
    }
    .pildora__quitar svg {
      width: 14px;
      height: 14px;
    }
    input {
      flex: 1 1 8rem;
      min-width: 8rem;
      padding: 4px 0;
      border: none;
      background: none;
      color: var(--fg);
      font: inherit;
    }
    input:focus {
      outline: none;
    }
    input::placeholder {
      color: var(--muted);
    }
    .sugerencias {
      position: absolute;
      z-index: 60;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 16rem;
      overflow: auto;
      margin: 0;
      padding: 4px;
      list-style: none;
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-md);
    }
    .sugerencia {
      padding: 0.5rem 0.75rem;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .sugerencia.activa,
    .sugerencia:hover {
      background: var(--surface-hi);
    }
    .error {
      margin: 0;
      color: var(--danger);
      font-size: 0.875rem;
    }
    .ayuda {
      margin: 0;
      color: var(--muted);
      font-size: 0.8125rem;
    }
  `,
})
export class TagsInput {
  readonly label = input.required<string>();
  readonly fieldId = input<string | null>(null);
  readonly hint = input<string | null>(null);
  /** Error que viene de fuera (p. ej. de la API); el de la etiqueta que se
   * intenta añadir lo pone el propio componente. */
  readonly error = input<string | null>(null);
  readonly placeholder = input('');
  readonly disabled = input(false);
  /** Máximo de etiquetas: al llegar, el campo deja de admitir texto. */
  readonly maximo = input<number | null>(null);
  /** Texto accesible del botón que quita una píldora. */
  readonly textoQuitar = input('Quitar');
  readonly normalizar = input<(texto: string) => string>((texto) => texto.trim());
  /** Devuelve el mensaje de error de una etiqueta nueva, o `null` si vale. */
  readonly validar = input<(etiqueta: string, actuales: readonly string[]) => string | null>(
    () => null,
  );
  readonly sugerencias = input<readonly string[]>([]);
  readonly value = model<string[]>([]);
  /** Texto escrito, con una espera, para que quien lo usa pida sugerencias. */
  readonly buscar = output<string>();

  private static contador = 0;
  private readonly indice = TagsInput.contador++;
  protected readonly idCampo = computed(() => this.fieldId() ?? `etiquetas-${this.indice}`);
  protected readonly idLista = computed(() => `${this.idCampo()}-sugerencias`);
  protected readonly idError = computed(() => `${this.idCampo()}-error`);
  protected readonly idAyuda = computed(() => `${this.idCampo()}-ayuda`);

  protected readonly texto = signal('');
  protected readonly indiceActivo = signal(-1);
  private readonly abierta = signal(false);
  private readonly errorPropio = signal<string | null>(null);
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  protected readonly mensajeError = computed(() => this.errorPropio() ?? this.error());
  protected readonly descripcionId = computed(() => {
    if (this.mensajeError()) return this.idError();
    if (this.hint()) return this.idAyuda();
    return null;
  });
  protected readonly lleno = computed(() => {
    const maximo = this.maximo();
    return maximo !== null && this.value().length >= maximo;
  });
  /** Sugerencias que todavía no están puestas. */
  protected readonly sugerenciasVisibles = computed(() =>
    this.sugerencias().filter((sugerencia) => !this.value().includes(sugerencia)),
  );
  protected readonly listaAbierta = computed(
    () => this.abierta() && this.sugerenciasVisibles().length > 0,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelarBusqueda());
  }

  protected idOpcion(indice: number): string {
    return `${this.idCampo()}-opcion-${indice}`;
  }

  protected alEscribir(evento: Event): void {
    const bruto = (evento.target as HTMLInputElement).value;
    // Una coma (escrita o pegada) cierra la etiqueta que la precede.
    if (bruto.includes(',')) {
      const partes = bruto.split(',');
      const resto = partes.pop() ?? '';
      for (const [indice, parte] of partes.entries()) {
        if (!this.anadir(parte)) {
          // Se para en la primera que no vale: queda en la caja con su aviso,
          // junto con lo que venía detrás, en vez de perderse sin decir nada.
          const pendiente = [parte.trim(), ...partes.slice(indice + 1), resto].join(',');
          this.ponerTexto(pendiente, evento.target as HTMLInputElement);
          return;
        }
      }
      this.ponerTexto(resto, evento.target as HTMLInputElement);
      return;
    }
    this.texto.set(bruto);
    this.errorPropio.set(null);
    this.abierta.set(true);
    this.indiceActivo.set(-1);
    this.programarBusqueda(bruto);
  }

  protected alPulsarTecla(evento: KeyboardEvent): void {
    const visibles = this.sugerenciasVisibles();
    switch (evento.key) {
      case 'Enter': {
        // Sin preventDefault, Intro enviaría el formulario entero.
        evento.preventDefault();
        const activa = this.listaAbierta() ? visibles[this.indiceActivo()] : undefined;
        this.anadir(activa ?? this.texto());
        return;
      }
      case 'ArrowDown':
        if (visibles.length === 0) return;
        evento.preventDefault();
        this.abierta.set(true);
        this.indiceActivo.set((this.indiceActivo() + 1) % visibles.length);
        return;
      case 'ArrowUp':
        if (visibles.length === 0) return;
        evento.preventDefault();
        this.abierta.set(true);
        this.indiceActivo.set(
          this.indiceActivo() <= 0 ? visibles.length - 1 : this.indiceActivo() - 1,
        );
        return;
      case 'Escape':
        if (this.listaAbierta()) {
          evento.preventDefault();
          this.abierta.set(false);
        }
        return;
      case 'Backspace':
        if (this.texto() === '' && this.value().length > 0) {
          evento.preventDefault();
          this.quitar(this.value()[this.value().length - 1]);
        }
        return;
    }
  }

  /** Al salir del campo, lo escrito a medias se convierte en píldora si vale. */
  protected alSalir(): void {
    this.abierta.set(false);
    if (this.texto().trim()) this.anadir(this.texto());
  }

  /** Devuelve `false` si la etiqueta no vale (y deja el motivo a la vista). */
  protected anadir(bruto: string): boolean {
    const etiqueta = this.normalizar()(bruto);
    if (!etiqueta) {
      this.texto.set('');
      return true;
    }
    if (this.value().includes(etiqueta)) {
      this.texto.set('');
      this.abierta.set(false);
      return true;
    }
    const error = this.validar()(etiqueta, this.value());
    if (error) {
      this.errorPropio.set(error);
      this.texto.set(etiqueta);
      return false;
    }
    this.value.set([...this.value(), etiqueta]);
    this.errorPropio.set(null);
    this.texto.set('');
    this.abierta.set(false);
    this.indiceActivo.set(-1);
    this.cancelarBusqueda();
    return true;
  }

  protected quitar(etiqueta: string): void {
    this.value.set(this.value().filter((actual) => actual !== etiqueta));
    this.errorPropio.set(null);
  }

  private ponerTexto(texto: string, caja: HTMLInputElement): void {
    this.texto.set(texto);
    caja.value = texto;
  }

  private programarBusqueda(texto: string): void {
    this.cancelarBusqueda();
    this.temporizador = setTimeout(() => this.buscar.emit(texto.trim()), ESPERA_SUGERENCIAS_MS);
  }

  private cancelarBusqueda(): void {
    if (this.temporizador !== null) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
  }
}
