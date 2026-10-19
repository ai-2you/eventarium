import { describe, expect, it } from 'vitest';

import { markdownToSafeHtml } from './sanitize-markdown';

describe('markdownToSafeHtml', () => {
  it('convierte párrafos, negrita y listas', () => {
    const html = markdownToSafeHtml('**Hola**\n\n- uno\n- dos');
    expect(html).toContain('<strong>Hola</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>uno</li>');
  });

  it('convierte enlaces conservando href y marcándolos como contenido de usuario', () => {
    const html = markdownToSafeHtml('[AEPD](https://www.aepd.es)');
    expect(html).toContain(
      '<a href="https://www.aepd.es" rel="nofollow ugc noopener noreferrer">AEPD</a>',
    );
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](//malicioso.example)',
    '[x](tel:+34600000000)',
    '<a href="/\\malicioso.example">x</a>',
  ])('quita el href de un enlace no web: %s', (markdown) => {
    const html = markdownToSafeHtml(markdown);
    expect(html).not.toMatch(/href=/i);
  });

  it('deja los enlaces dentro del propio sitio', () => {
    expect(markdownToSafeHtml('[cookies](/legal/cookies)')).toContain('href="/legal/cookies"');
    expect(markdownToSafeHtml('[arriba](#datos)')).toContain('href="#datos"');
  });

  it('deja los enlaces mailto', () => {
    expect(markdownToSafeHtml('[escríbenos](mailto:hola@example.com)')).toContain(
      'href="mailto:hola@example.com"',
    );
  });

  it('con saltos, un salto de línea simple se respeta; sin ellos, se une', () => {
    expect(markdownToSafeHtml('uno\ndos', { saltos: true })).toContain('<br>');
    expect(markdownToSafeHtml('uno\ndos')).not.toContain('<br>');
  });

  it('elimina un <script> guardado como contenido legal', () => {
    const html = markdownToSafeHtml('Texto normal.\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('elimina atributos on* aunque vengan en una etiqueta permitida', () => {
    const html = markdownToSafeHtml('<p onclick="alert(1)">hola</p>');
    expect(html).not.toContain('onclick');
  });

  it('elimina un iframe incrustado', () => {
    const html = markdownToSafeHtml('<iframe src="https://malicioso.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('no interpreta el Markdown de encabezados (fuera de la lista blanca)', () => {
    const html = markdownToSafeHtml('# Título');
    expect(html).not.toContain('<h1');
  });
});
