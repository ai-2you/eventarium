import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Editor } from '@tiptap/core';

import { markdownToSafeHtml } from '../legal/sanitize-markdown';
import { Button } from './button';
import { Dialog } from './dialog';
import { Input } from './input';

/** Enlaces que admite el editor: los mismos que deja pasar el saneador. */
const URL_PERMITIDA = /^(?:https?:\/\/|mailto:)/i;

interface EstadoDeFormato {
  readonly negrita: boolean;
  readonly cursiva: boolean;
  readonly titulo: boolean;
  readonly subtitulo: boolean;
  readonly lista: boolean;
  readonly listaNumerada: boolean;
  readonly enlace: boolean;
}

const SIN_FORMATO: EstadoDeFormato = {
  negrita: false,
  cursiva: false,
  titulo: false,
  subtitulo: false,
  lista: false,
  listaNumerada: false,
  enlace: false,
};

/** Lo guardado (Markdown, quizá escrito por la API o el MCP sin pasar por este
 * editor) → HTML saneado con la misma lista blanca con la que se pinta en
 * público. Los saltos simples se conservan: las descripciones anteriores al
 * editor eran texto plano y perderían sus saltos al volver a guardarse. */
function aHtmlSeguro(markdown: string): string {
  return markdownToSafeHtml(markdown, { saltos: true });
}

/**
 * Editor de texto enriquecido que guarda **Markdown**: lo que escribe la
 * organización se pinta en público con `app-markdown-seguro`, nunca como HTML
 * propio. Solo ofrece lo que esa lista blanca admite: negrita, cursiva, título
 * y subtítulo, listas y enlaces web o de correo.
 *
 * Tiptap se carga en diferido y solo en el navegador (`afterNextRender`): no
 * pesa en el resto del panel ni se ejecuta en el servidor.
 */
@Component({
  selector: 'app-rich-text-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, Button, Dialog, Input],
  template: `
    <ng-container *transloco="let t">
      <div class="campo">
        <span class="rotulo" [id]="idRotulo()">{{ label() }}</span>
        <div class="marco" [class.invalido]="error()">
          <div class="barra" role="toolbar" [attr.aria-label]="t('comun.editor.barra')">
            @for (accion of acciones; track accion.clave) {
              <button
                type="button"
                class="boton"
                [attr.aria-label]="t('comun.editor.' + accion.clave)"
                [attr.title]="t('comun.editor.' + accion.clave)"
                [attr.aria-pressed]="estado()[accion.clave]"
                [disabled]="!listo()"
                (mousedown)="$event.preventDefault()"
                (click)="aplicar(accion.clave)"
              >
                @if (accion.clave === 'enlace') {
                  <svg
                    class="icono"
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                    <path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                  </svg>
                } @else {
                  <span aria-hidden="true" [class]="'icono icono--' + accion.clave">{{
                    accion.icono
                  }}</span>
                }
              </button>
            }
          </div>
          <div #anfitrion class="editor"></div>
        </div>
        <div class="pie">
          @if (error(); as mensaje) {
            <p class="error" [id]="idDescripcion()">{{ mensaje }}</p>
          } @else if (hint()) {
            <p class="ayuda" [id]="idDescripcion()">{{ hint() }}</p>
          }
          @if (longitudMaxima(); as maximo) {
            <p class="contador" [class.excedido]="value().length > maximo">
              {{ value().length }} / {{ maximo }}
            </p>
          }
        </div>
      </div>

      <app-dialog #dialogoEnlace (cerrado)="errorEnlace.set(null)">
        <h3 class="titulo-dialogo">{{ t('comun.editor.enlaceTitulo') }}</h3>
        <app-input
          [fieldId]="idCampo() + '-url'"
          type="url"
          [label]="t('comun.editor.enlaceUrl')"
          [hint]="t('comun.editor.enlaceAyuda')"
          [error]="errorEnlace() ? t('comun.editor.enlaceInvalido') : null"
          [(value)]="urlEnlace"
        />
        @if (estado().enlace) {
          <app-button pie variant="secundario" type="button" (pulsado)="quitarEnlace()">
            {{ t('comun.editor.enlaceQuitar') }}
          </app-button>
        }
        <app-button pie variant="secundario" type="button" (pulsado)="dialogoEnlace.cerrar()">
          {{ t('comun.cancelar') }}
        </app-button>
        <app-button pie type="button" (pulsado)="confirmarEnlace()">
          {{ t('comun.editor.enlaceAplicar') }}
        </app-button>
      </app-dialog>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
    .campo {
      display: grid;
      gap: var(--space-xs);
    }
    .rotulo {
      font-size: var(--fs-sm);
      font-weight: 500;
      color: var(--muted);
    }
    .marco {
      background: var(--surface-2);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      transition: border-color 0.15s;
    }
    .marco:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .marco.invalido {
      border-color: var(--danger);
    }
    .barra {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      padding: 4px;
      border-bottom: 1px solid var(--border);
    }
    .boton {
      display: grid;
      place-items: center;
      min-width: 2.25rem;
      height: 2.25rem;
      padding: 0 0.5rem;
      border: none;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--muted);
      font: inherit;
      cursor: pointer;
    }
    .boton:hover:not(:disabled) {
      background: var(--surface-hi);
      color: var(--fg);
    }
    .boton[aria-pressed='true'] {
      background: var(--surface-hi);
      color: var(--accent);
    }
    .boton:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    svg.icono {
      width: 18px;
      height: 18px;
    }
    .icono--negrita {
      font-weight: 700;
    }
    .icono--cursiva {
      font-style: italic;
    }
    .editor ::ng-deep .ProseMirror {
      min-height: 10rem;
      max-height: 32rem;
      overflow-y: auto;
      padding: 0.75rem;
      color: var(--fg);
      line-height: 1.6;
      outline: none;
    }
    .editor ::ng-deep .ProseMirror > :first-child {
      margin-top: 0;
    }
    .editor ::ng-deep .ProseMirror ul,
    .editor ::ng-deep .ProseMirror ol {
      padding-inline-start: 1.5rem;
    }
    .editor ::ng-deep .ProseMirror a {
      color: var(--accent);
    }
    .pie {
      display: flex;
      justify-content: space-between;
      gap: var(--space-sm);
    }
    .error {
      margin: 0;
      color: var(--danger);
      font-size: 0.875rem;
    }
    .ayuda,
    .contador {
      margin: 0;
      color: var(--muted);
      font-size: 0.8125rem;
    }
    .contador {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
    }
    .contador.excedido {
      color: var(--danger);
    }
    .titulo-dialogo {
      margin: 0 0 var(--space-md);
    }
  `,
})
export class RichTextEditor {
  readonly label = input.required<string>();
  readonly fieldId = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  /** Tope de caracteres del Markdown guardado; se muestra como contador. */
  readonly longitudMaxima = input<number | null>(null);
  /** El texto en Markdown. */
  readonly value = model('');

  protected readonly acciones = [
    { clave: 'negrita', icono: 'B' },
    { clave: 'cursiva', icono: 'I' },
    { clave: 'titulo', icono: 'H2' },
    { clave: 'subtitulo', icono: 'H3' },
    { clave: 'lista', icono: '•' },
    { clave: 'listaNumerada', icono: '1.' },
    { clave: 'enlace', icono: '' },
  ] as const;

  private static contador = 0;
  private readonly indice = RichTextEditor.contador++;
  /** El área editable lleva el id del campo: es a donde tiene que llevar el
   * foco un enlace del resumen de errores. */
  protected readonly idCampo = computed(() => this.fieldId() ?? `editor-${this.indice}`);
  protected readonly idRotulo = computed(() => `${this.idCampo()}-rotulo`);
  protected readonly idDescripcion = computed(() => `${this.idCampo()}-descripcion`);

  protected readonly listo = signal(false);
  protected readonly estado = signal<EstadoDeFormato>(SIN_FORMATO);
  protected readonly urlEnlace = signal('');
  protected readonly errorEnlace = signal<string | null>(null);

  private readonly anfitrion = viewChild.required<ElementRef<HTMLElement>>('anfitrion');
  private readonly dialogoEnlace = viewChild.required<Dialog>('dialogoEnlace');
  private editor: Editor | null = null;
  /** Lo último que el propio editor ha escrito en `value`: un cambio distinto
   * viene de fuera (cargar el evento) y hay que volcarlo al editor. */
  private ultimoEmitido: string | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    let destruido = false;
    destroyRef.onDestroy(() => {
      destruido = true;
      this.editor?.destroy();
      this.editor = null;
    });
    afterNextRender(() => {
      void this.montar(() => destruido);
    });

    // El error (p. ej. «demasiado larga») aparece después de montar el editor:
    // el área editable tiene que seguir apuntando a él.
    effect(() => {
      const describe = this.error() || this.hint() ? this.idDescripcion() : null;
      if (!this.listo()) return;
      const area = this.editor?.view.dom;
      if (!area) return;
      if (describe) area.setAttribute('aria-describedby', describe);
      else area.removeAttribute('aria-describedby');
    });

    effect(() => {
      const valor = this.value();
      if (!this.listo() || valor === this.ultimoEmitido) return;
      untracked(() => {
        this.ultimoEmitido = valor;
        this.editor?.commands.setContent(aHtmlSeguro(valor), { emitUpdate: false });
        this.refrescarEstado();
      });
    });
  }

  private async montar(destruido: () => boolean): Promise<void> {
    const [{ Editor }, { StarterKit }, { Markdown }] = await Promise.all([
      import('@tiptap/core'),
      import('@tiptap/starter-kit'),
      import('@tiptap/markdown'),
    ]);
    if (destruido()) return;
    const inicial = this.value();
    this.ultimoEmitido = inicial;
    this.editor = new Editor({
      element: this.anfitrion().nativeElement,
      extensions: [
        // Solo lo que la lista blanca de `markdownToSafeHtml` sabe pintar:
        // cualquier otro nodo se perdería sin aviso al publicarse.
        StarterKit.configure({
          heading: { levels: [2, 3] },
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          underline: false,
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
            protocols: ['mailto'],
            isAllowedUri: (url) => URL_PERMITIDA.test(url),
          },
        }),
        Markdown,
      ],
      content: aHtmlSeguro(inicial),
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          id: this.idCampo(),
          'aria-labelledby': this.idRotulo(),
        },
      },
      onUpdate: ({ editor }) => {
        const markdown = editor.getMarkdown();
        this.ultimoEmitido = markdown;
        this.value.set(markdown);
      },
      onTransaction: () => this.refrescarEstado(),
    });
    this.listo.set(true);
    this.refrescarEstado();
  }

  protected aplicar(accion: (typeof this.acciones)[number]['clave']): void {
    const editor = this.editor;
    if (!editor) return;
    const cadena = editor.chain().focus();
    switch (accion) {
      case 'negrita':
        cadena.toggleBold().run();
        return;
      case 'cursiva':
        cadena.toggleItalic().run();
        return;
      case 'titulo':
        cadena.toggleHeading({ level: 2 }).run();
        return;
      case 'subtitulo':
        cadena.toggleHeading({ level: 3 }).run();
        return;
      case 'lista':
        cadena.toggleBulletList().run();
        return;
      case 'listaNumerada':
        cadena.toggleOrderedList().run();
        return;
      case 'enlace':
        this.urlEnlace.set((editor.getAttributes('link')['href'] as string | undefined) ?? '');
        this.errorEnlace.set(null);
        this.dialogoEnlace().abrir();
        return;
    }
  }

  protected confirmarEnlace(): void {
    const url = this.urlEnlace().trim();
    if (!url) {
      this.quitarEnlace();
      return;
    }
    if (!URL_PERMITIDA.test(url)) {
      this.errorEnlace.set(url);
      return;
    }
    this.editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    this.dialogoEnlace().cerrar();
  }

  protected quitarEnlace(): void {
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.dialogoEnlace().cerrar();
  }

  private refrescarEstado(): void {
    const editor = this.editor;
    if (!editor) return;
    this.estado.set({
      negrita: editor.isActive('bold'),
      cursiva: editor.isActive('italic'),
      titulo: editor.isActive('heading', { level: 2 }),
      subtitulo: editor.isActive('heading', { level: 3 }),
      lista: editor.isActive('bulletList'),
      listaNumerada: editor.isActive('orderedList'),
      enlace: editor.isActive('link'),
    });
  }
}
