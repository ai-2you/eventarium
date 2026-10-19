import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Lista blanca explícita del contenido legal: párrafos, apartados (`h2`/`h3`:
 * un documento legal se organiza por secciones; `h1` no, que es el título de
 * la página), negrita/cursiva, listas y enlaces. Nunca `<script>`, `<iframe>`
 * ni atributos `on*` — `ALLOWED_ATTR` ni siquiera los declara, así que
 * DOMPurify los descarta sin necesidad de una lista negra.
 */
const ETIQUETAS_PERMITIDAS = [
  'p',
  'h2',
  'h3',
  'strong',
  'em',
  'b',
  'i',
  'ul',
  'ol',
  'li',
  'a',
  'br',
];
const ATRIBUTOS_PERMITIDOS = ['href'];

/** Solo enlaces web y de correo: ni `javascript:` ni `data:`, pero tampoco
 * URLs relativas al protocolo (`//dominio`), rutas relativas, `tel:`… que la
 * expresión por defecto de DOMPurify sí deja pasar. */
const URIS_PERMITIDAS = /^(?:https?:|mailto:)/i;

marked.setOptions({ async: false, gfm: true, breaks: false });

// Todo enlace escrito por terceros sale marcado como contenido de usuario: sin
// esto, una organización podría usar las fichas para posicionar enlaces con la
// autoridad del dominio de la plataforma. Se añade después de sanear, así que
// `rel` no necesita estar en la lista blanca de atributos.
//
// Se registra la primera vez que se sanea, nunca al importar el módulo: en el
// servidor (SSR) no hay `window` y DOMPurify ni siquiera expone `addHook`, así
// que registrarlo al cargar tumbaba el render de cualquier página que lo
// importara.
let enlacesMarcados = false;
function marcarEnlacesDeTerceros(): void {
  if (enlacesMarcados || !DOMPurify.isSupported) return;
  DOMPurify.addHook('afterSanitizeAttributes', (nodo) => {
    if (nodo.tagName === 'A') {
      nodo.setAttribute('rel', 'nofollow ugc noopener noreferrer');
    }
  });
  enlacesMarcados = true;
}

export interface OpcionesMarkdown {
  /** Un salto de línea simple se respeta como `<br>`: para textos que se
   * escribieron como texto plano antes de admitir Markdown (la descripción de
   * un evento). Los textos legales lo dejan desactivado. */
  readonly saltos?: boolean;
}

/**
 * Markdown → HTML saneado.
 *
 * Solo se llama desde el navegador (nunca en SSR, ver `legal-page.ts`):
 * `DOMPurify` necesita un `window` con DOM real, que Node no tiene sin una
 * dependencia adicional (`jsdom`) que solo haría falta para este único caso.
 * Mientras no se ejecuta esta función, el contenido se muestra como texto
 * plano interpolado por Angular (siempre escapado, nunca HTML), así que un
 * `<script>` guardado en el contenido legal no se ejecuta ni antes ni después
 * de que esta función corra.
 */
// INVARIANTE: nunca bindees `[innerHTML]` con texto de organización (contenido
// legal, políticas del organizador, campos libres, lo que sea que edite alguien
// fuera del equipo). Se pinta siempre con `<app-markdown-seguro>`
// (`markdown-seguro.ts`), el único consumidor de esta función; un test recorre
// `src/app` para que no aparezca otro `[innerHTML]` con ese contenido.
export function markdownToSafeHtml(markdown: string, opciones: OpcionesMarkdown = {}): string {
  marcarEnlacesDeTerceros();
  const html = marked.parse(markdown, { async: false, breaks: opciones.saltos ?? false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ETIQUETAS_PERMITIDAS,
    ALLOWED_ATTR: ATRIBUTOS_PERMITIDOS,
    ALLOWED_URI_REGEXP: URIS_PERMITIDAS,
  });
}
