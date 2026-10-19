import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Norma del dueño: ningún desplegable nativo ni diálogo nativo del navegador en
 * la interfaz. Todo desplegable es `app-select` y toda confirmación un
 * `app-dialog`. El único `<select>` permitido es el espejo oculto del propio
 * `app-select`, que conserva el valor para formularios y lectores de pantalla.
 */
const RAIZ = join(import.meta.dirname, '../app');
const PERMITIDOS = new Set(['shared/ui/select.ts']);
/** El espejo oculto del propio `app-datetime-picker`. */
const FECHA_PERMITIDOS = new Set(['shared/ui/datetime-picker.ts']);

function ficherosFuente(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) {
      return nombre === 'generated' ? [] : ficherosFuente(ruta);
    }
    return nombre.endsWith('.ts') && !nombre.endsWith('.spec.ts') ? [ruta] : [];
  });
}

/** El código sin comentarios: un `<select>` mencionado en un comentario no es
 * un control. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('controles nativos', () => {
  const fuentes = ficherosFuente(RAIZ)
    .map((ruta) => ({
      ruta: relative(RAIZ, ruta),
      codigo: sinComentarios(readFileSync(ruta, 'utf-8')),
    }))
    .filter(({ ruta }) => !PERMITIDOS.has(ruta));

  it('recorre de verdad el código de la aplicación', () => {
    expect(fuentes.length).toBeGreaterThan(50);
  });

  it('no hay ningún <select> nativo fuera de app-select', () => {
    const conSelect = fuentes
      .filter(({ codigo }) => /<select[\s>]/.test(codigo))
      .map((f) => f.ruta);
    expect(conSelect).toEqual([]);
  });

  it('no hay selectores de fecha u hora nativos fuera de app-datetime-picker', () => {
    const conFechaNativa = fuentes
      .filter(({ ruta }) => !FECHA_PERMITIDOS.has(ruta))
      .filter(({ codigo }) => /type="(date|time|datetime-local|month|week)"/.test(codigo))
      .map((f) => f.ruta);
    expect(conFechaNativa).toEqual([]);
  });

  it('no se usan alert, confirm ni prompt del navegador', () => {
    const conDialogo = fuentes
      .filter(({ codigo }) => /\b(window\.)?(alert|confirm|prompt)\(/.test(codigo))
      .map((f) => f.ruta);
    expect(conDialogo).toEqual([]);
  });
});
