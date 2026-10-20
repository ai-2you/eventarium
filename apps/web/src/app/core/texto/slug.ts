// Marcas diacríticas combinantes (U+0300-U+036F) que deja `normalize('NFD')`
// separadas de la letra base: quitarlas es lo que convierte «Á» en «a» y no en «á».
const MARCAS_DIACRITICAS = /[̀-ͯ]/g;

/** Texto → identificador de URL: sin acentos, en minúsculas y con guiones entre
 * palabras. `longitudMaxima` recorta sin dejar un guion colgando al final. */
export function slugify(texto: string, longitudMaxima?: number): string {
  const slug = texto
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return longitudMaxima === undefined ? slug : slug.slice(0, longitudMaxima).replace(/-+$/, '');
}
