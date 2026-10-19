import { describe, expect, it } from 'vitest';

import { slugify } from './slug';

describe('slugify', () => {
  it('quita acentos, pasa a minúsculas y une con guiones', () => {
    expect(slugify('  Evento con el Aforo Completo ¡2026! ')).toBe(
      'evento-con-el-aforo-completo-2026',
    );
    expect(slugify('Ñandú y Árbol')).toBe('nandu-y-arbol');
  });

  it('recorta a la longitud máxima sin dejar un guion al final', () => {
    expect(slugify('uno dos tres', 8)).toBe('uno-dos');
  });

  it('un texto sin letras ni números da cadena vacía', () => {
    expect(slugify('¡¿?!')).toBe('');
  });
});
