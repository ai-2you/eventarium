import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

/**
 * Un ponente entra en el panel y solo ve lo suyo: aterriza en su cuenta, el
 * menú no le ofrece ninguna pantalla de gestión y, si escribe la URL de una,
 * vuelve a su cuenta. El ponente se da de alta por API (registro propio + rol
 * de ponente que le añade el organizador), sin el flujo de invitación por
 * interfaz, que es lento y ya lo cubre `invitaciones.movil.spec.ts`.
 */

const MAILPIT = process.env['E2E_MAILPIT_URL'] ?? 'http://localhost:8025';
const PASSWORD = 'Ponente-e2e-Pr0bando!';

async function enlaceDeVerificacion(request: APIRequestContext, correo: string): Promise<string> {
  for (let intento = 0; intento < 30; intento++) {
    const busqueda = await request.get(`${MAILPIT}/api/v1/search`, {
      params: { query: `to:${correo}` },
    });
    const { messages } = (await busqueda.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const mensaje = await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
      const { Text } = (await mensaje.json()) as { Text: string };
      const enlace = Text.match(/https?:\/\/\S*verificar-correo\?token=[^\s]+/)?.[0];
      if (enlace) return new URL(enlace).pathname + new URL(enlace).search;
    }
    await new Promise((resolver) => setTimeout(resolver, 1000));
  }
  throw new Error(`No ha llegado a Mailpit el correo de verificación de ${correo}`);
}

async function registrarYVerificar(page: Page, correo: string): Promise<void> {
  const alta = await page.request.post('/api/v1/auth/register', {
    data: { email: correo, password: PASSWORD, turnstile_token: 'e2e' },
  });
  expect(alta.status(), await alta.text()).toBe(202);
  // La página verifica al cargar: navegar antes de que responda cancela la
  // petición y la cuenta se queda sin verificar (y sin ficha que mostrar).
  const verificacion = page.waitForResponse((respuesta) =>
    respuesta.url().includes('/api/v1/auth/verify-email'),
  );
  await page.goto(await enlaceDeVerificacion(page.request, correo));
  expect((await verificacion).ok()).toBe(true);
}

async function tokenDe(request: APIRequestContext, correo: string): Promise<string> {
  const sesion = await request.post('/api/v1/auth/login', {
    data: { email: correo, password: PASSWORD },
  });
  expect(sesion.status(), await sesion.text()).toBe(200);
  return ((await sesion.json()) as { access_token: string }).access_token;
}

test.describe('Panel de un ponente', () => {
  test('solo ve su cuenta y no entra en la gestión', async ({ browser }) => {
    test.setTimeout(180_000);
    const sello = Date.now();
    // Mailpit busca `to:` por subcadena: ningún correo puede contener al otro.
    const correoOrganizador = `organizador-${sello}@example.com`;
    const correoPonente = `ponente-${sello}@example.com`;

    // Organizador con su organización.
    const organizador = await browser.newPage();
    await registrarYVerificar(organizador, correoOrganizador);
    await organizador.waitForURL('**/crear-organizacion');
    await organizador.getByLabel('Nombre de la organización').fill(`Ponentes ${sello}`);
    await organizador.getByLabel('Tu nombre').fill('Org');
    await organizador.getByLabel('Tus apellidos').fill('Prueba');
    await organizador.getByRole('button', { name: 'Crear organización' }).click();
    await organizador.waitForURL('**/dashboard**');
    // El organizador sí ve la gestión: el menú se pinta y filtra, no es que
    // no salga nada para nadie.
    await expect(organizador.locator('app-admin-nav a[href="/dashboard/events"]')).toHaveCount(1);

    // El ponente tiene cuenta propia y el organizador le da el rol de ponente.
    const ponente = await browser.newPage();
    await registrarYVerificar(ponente, correoPonente);
    const tokenOrganizador = await tokenDe(organizador.request, correoOrganizador);
    const cabeceras = { Authorization: `Bearer ${tokenOrganizador}` };
    const roles = (await (
      await organizador.request.get('/api/v1/roles', { headers: cabeceras })
    ).json()) as { id: string; key: string }[];
    const rolPonente = roles.find((rol) => rol.key === 'speaker');
    expect(rolPonente).toBeDefined();
    const miembro = await organizador.request.post('/api/v1/organizations/me/members', {
      headers: cabeceras,
      data: {
        email: correoPonente,
        first_name: 'Pon',
        last_name: 'Ente',
        role_id: rolPonente!.id,
        profile_data: { bio: 'Ponente de prueba.' },
      },
    });
    expect(miembro.status(), await miembro.text()).toBe(201);

    // El ponente entra en el panel: el login deja la cookie de refresco en su
    // contexto y el panel la usa al cargar.
    await tokenDe(ponente.request, correoPonente);
    await ponente.goto('/dashboard');
    await ponente.waitForURL('**/dashboard/account');

    const navegacion = ponente.locator('app-admin-nav');
    for (const ruta of ['/dashboard/roles', '/dashboard/members', '/dashboard/events']) {
      await expect(navegacion.locator(`a[href="${ruta}"]`)).toHaveCount(0);
    }

    await ponente.goto('/dashboard/roles');
    await ponente.waitForURL('**/dashboard/account');

    // Su ficha, adonde lleva el correo que pide la biografía: la escribe y queda.
    await ponente.goto('/dashboard/account#ficha');
    const ficha = ponente.locator('#ficha');
    await expect(ficha).toContainText('Mi ficha de');
    const bio = ficha.getByLabel('Biografía');
    await expect(bio).toHaveValue('Ponente de prueba.');
    await bio.fill('Investiga IA aplicada a la salud.');
    await ficha.getByRole('button', { name: 'Guardar ficha' }).click();
    await expect(ficha).toContainText('Ficha guardada');
    await ponente.reload();
    await expect(ponente.locator('#ficha').getByLabel('Biografía')).toHaveValue(
      'Investiga IA aplicada a la salud.',
    );
  });
});
