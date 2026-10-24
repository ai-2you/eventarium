import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { esperarSinViolacionesDeAccesibilidad } from '../../../testing/axe';
import { TagsInput } from './tags-input';

describe('TagsInput', () => {
  let fixture: ComponentFixture<TagsInput>;
  let caja: HTMLInputElement;

  async function montar(entradas: Record<string, unknown> = {}): Promise<void> {
    TestBed.configureTestingModule({
      imports: [TagsInput],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(TagsInput);
    fixture.componentRef.setInput('label', 'Etiquetas');
    fixture.componentRef.setInput('fieldId', 'etiquetas');
    fixture.componentRef.setInput('normalizar', (t: string) => t.trim().toLowerCase());
    for (const [nombre, valor] of Object.entries(entradas)) {
      fixture.componentRef.setInput(nombre, valor);
    }
    await fixture.whenStable();
    caja = fixture.nativeElement.querySelector('#etiquetas') as HTMLInputElement;
  }

  async function escribir(texto: string): Promise<void> {
    caja.value = texto;
    caja.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function pulsar(tecla: string): Promise<void> {
    caja.dispatchEvent(new KeyboardEvent('keydown', { key: tecla, cancelable: true }));
    await fixture.whenStable();
  }

  function pildoras(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.pildora span')).map(
      (s) => (s as HTMLElement).textContent?.trim() ?? '',
    );
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('la coma y el Intro convierten lo escrito en píldoras normalizadas', async () => {
    await montar();

    await escribir('IA, Datos');
    expect(pildoras()).toEqual(['ia']);
    expect(caja.value).toBe(' Datos');

    await pulsar('Enter');
    expect(pildoras()).toEqual(['ia', 'datos']);
    expect(fixture.componentInstance.value()).toEqual(['ia', 'datos']);
    expect(caja.value).toBe('');
  });

  it('la X quita una píldora y Retroceso con el campo vacío quita la última', async () => {
    await montar({ value: ['uno', 'dos', 'tres'] });

    (
      fixture.nativeElement.querySelector('[aria-label="Quitar «dos»"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(pildoras()).toEqual(['uno', 'tres']);

    await pulsar('Backspace');
    expect(pildoras()).toEqual(['uno']);
  });

  it('una etiqueta no válida no se añade y muestra el motivo', async () => {
    await montar({ validar: (e: string) => (e.length < 2 ? 'Demasiado corta.' : null) });

    await escribir('a');
    await pulsar('Enter');

    expect(pildoras()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Demasiado corta.');
    expect(caja.getAttribute('aria-invalid')).toBe('true');
  });

  it('al llegar al máximo deja de admitir texto sin perder el foco', async () => {
    await montar({ value: ['a1', 'b2'], maximo: 2 });
    expect(caja.readOnly).toBe(true);
    expect(caja.disabled).toBe(false);
    expect(caja.getAttribute('aria-disabled')).toBe('true');
  });

  it('al pegar con comas, se para en la primera inválida y la deja en la caja', async () => {
    await montar({ validar: (e: string) => (e.length < 2 ? 'Demasiado corta.' : null) });

    await escribir('ia, x, datos, ');

    expect(pildoras()).toEqual(['ia']);
    expect(caja.value).toBe('x, datos, ');
    expect(fixture.nativeElement.textContent).toContain('Demasiado corta.');
  });

  it('pide sugerencias tras escribir y deja elegirlas con el teclado', async () => {
    await montar();
    const buscar = vi.fn();
    fixture.componentInstance.buscar.subscribe(buscar);

    await escribir('da');
    vi.advanceTimersByTime(250);
    expect(buscar).toHaveBeenCalledWith('da');

    fixture.componentRef.setInput('sugerencias', ['datos', 'big data']);
    await fixture.whenStable();
    expect(caja.getAttribute('aria-expanded')).toBe('true');

    await pulsar('ArrowDown');
    await pulsar('ArrowDown');
    expect(caja.getAttribute('aria-activedescendant')).toBe('etiquetas-opcion-1');
    await pulsar('Enter');

    expect(pildoras()).toEqual(['big data']);
    expect(caja.getAttribute('aria-expanded')).toBe('false');
  });

  it('no sugiere lo que ya está puesto', async () => {
    await montar({ value: ['datos'] });
    await escribir('d');
    fixture.componentRef.setInput('sugerencias', ['datos', 'diseño']);
    await fixture.whenStable();

    const opciones = Array.from(fixture.nativeElement.querySelectorAll('[role="option"]')).map(
      (o) => (o as HTMLElement).textContent?.trim(),
    );
    expect(opciones).toEqual(['diseño']);
  });

  it('sin violaciones de accesibilidad con píldoras y sugerencias abiertas', async () => {
    vi.useRealTimers();
    await montar({ value: ['ia'] });
    await escribir('d');
    fixture.componentRef.setInput('sugerencias', ['datos']);
    await fixture.whenStable();
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  }, 20_000);
});
