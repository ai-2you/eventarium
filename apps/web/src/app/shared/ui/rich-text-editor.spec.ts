import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { Editor } from '@tiptap/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import es from '../../../../public/assets/i18n/es-ES.json';
import { emularDialogoNativo } from '../../../testing/dialog';
import { RichTextEditor } from './rich-text-editor';

interface Interno {
  readonly editor: Editor | null;
  readonly listo: () => boolean;
  aplicar(accion: string): void;
  urlEnlace: { set(valor: string): void };
  confirmarEnlace(): void;
  errorEnlace: () => string | null;
}

describe('RichTextEditor', () => {
  beforeAll(() => {
    // ProseMirror mide la selección con APIs de maquetación que jsdom no tiene.
    const rectVacio = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    });
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rectVacio() as DOMRect;
    document.elementFromPoint = () => null;
    emularDialogoNativo();
  });

  async function montar(valor: string): Promise<ComponentFixture<RichTextEditor>> {
    TestBed.configureTestingModule({
      imports: [
        RichTextEditor,
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(RichTextEditor);
    fixture.componentRef.setInput('label', 'Descripción');
    fixture.componentRef.setInput('fieldId', 'descripcion');
    fixture.componentInstance.value.set(valor);
    await fixture.whenStable();
    await vi.waitFor(() => expect(interno(fixture).listo()).toBe(true), { timeout: 5000 });
    await fixture.whenStable();
    return fixture;
  }

  function interno(fixture: ComponentFixture<RichTextEditor>): Interno {
    return fixture.componentInstance as unknown as Interno;
  }

  function areaEditable(fixture: ComponentFixture<RichTextEditor>): HTMLElement {
    return fixture.nativeElement.querySelector('.ProseMirror') as HTMLElement;
  }

  it('pinta el Markdown guardado y está etiquetado como campo de texto', async () => {
    const fixture = await montar('**Hola** y _adiós_\n\n- uno\n- dos');
    const area = areaEditable(fixture);

    expect(area.innerHTML).toContain('<strong>Hola</strong>');
    expect(area.innerHTML).toContain('<em>adiós</em>');
    expect(area.querySelectorAll('li').length).toBe(2);
    expect(area.getAttribute('role')).toBe('textbox');
    expect(area.id).toBe('descripcion');
    expect(area.getAttribute('aria-labelledby')).toBe('descripcion-rotulo');
  });

  it('al editar guarda Markdown, no HTML', async () => {
    const fixture = await montar('');
    const editor = interno(fixture).editor as Editor;

    editor.commands.insertContent('Charla');
    editor.commands.selectAll();
    interno(fixture).aplicar('negrita');
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('**Charla**');
  });

  it('el HTML hostil guardado por la API no llega al editor', async () => {
    const fixture = await montar(
      'Texto <img src="x" onerror="alert(1)"> y [pincha](javascript:alert(1))\n\n<script>alert(2)</script>',
    );
    const html = areaEditable(fixture).innerHTML;

    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('Texto');
  });

  it('una descripción antigua en texto plano conserva sus saltos de línea al guardarse', async () => {
    const fixture = await montar('Primera línea\nSegunda línea');
    const editor = interno(fixture).editor as Editor;

    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '.');
    await fixture.whenStable();

    const guardado = fixture.componentInstance.value();
    expect(guardado).toMatch(/Primera línea(\\|\s{2})\nSegunda línea/);
  });

  it('solo admite enlaces web o de correo', async () => {
    const fixture = await montar('palabra');
    const editor = interno(fixture).editor as Editor;
    editor.commands.selectAll();

    interno(fixture).aplicar('enlace');
    interno(fixture).urlEnlace.set('javascript:alert(1)');
    interno(fixture).confirmarEnlace();
    await fixture.whenStable();
    expect(interno(fixture).errorEnlace()).not.toBeNull();
    expect(fixture.componentInstance.value()).toBe('palabra');

    interno(fixture).urlEnlace.set('https://eventarium.org');
    interno(fixture).confirmarEnlace();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('[palabra](https://eventarium.org)');
  });

  it('un valor que llega después (cargar el evento) se vuelca al editor', async () => {
    const fixture = await montar('');

    fixture.componentInstance.value.set('## Programa');
    await fixture.whenStable();

    expect(areaEditable(fixture).querySelector('h2')?.textContent).toBe('Programa');
  });

  it('un error que aparece después queda asociado al área editable', async () => {
    const fixture = await montar('texto');
    expect(areaEditable(fixture).hasAttribute('aria-describedby')).toBe(false);

    fixture.componentRef.setInput('error', 'Demasiado larga.');
    await fixture.whenStable();

    expect(areaEditable(fixture).getAttribute('aria-describedby')).toBe('descripcion-descripcion');
    expect(fixture.nativeElement.querySelector('#descripcion-descripcion')?.textContent).toContain(
      'Demasiado larga.',
    );
  });
});
