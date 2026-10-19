import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MembersPage } from './members-page';
import { AuthService } from '../../../core/auth/auth.service';
import { TODOS_LOS_PERMISOS, authConPermisos } from '../../../../testing/auth';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';

function pagina(total: number, offset: number) {
  return {
    items: [
      {
        user_id: 'u1',
        email: 'persona@example.com',
        first_name: 'Persona',
        last_name: 'De Prueba',
        roles: [{ id: 'm1', role_id: 'r1', role_key: 'owner', role_name: 'Propietario' }],
        profile_data: {},
      },
    ],
    total,
    limit: 20,
    offset,
  };
}

function personaConDosRoles() {
  return {
    items: [
      {
        user_id: 'u2',
        email: 'doble@example.com',
        first_name: 'Doble',
        last_name: 'Rol',
        roles: [
          { id: 'm1', role_id: 'r1', role_key: 'organizer', role_name: 'Organizador' },
          { id: 'm2', role_id: 'r2', role_key: 'volunteer', role_name: 'Voluntariado' },
        ],
        profile_data: {},
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  };
}

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

/** `InvitationsPanel` (fase 2) pide sus dos listas al construirse: se agota aparte. */
async function flushPanelDeInvitaciones(
  http: HttpTestingController,
  fixture: ComponentFixture<unknown>,
): Promise<void> {
  http.expectOne((peticion) => peticion.url === '/api/v1/organizations/me/invitations').flush([]);
  http.expectOne((peticion) => peticion.url === '/api/v1/roles').flush([]);
  await avanzar(fixture);
  // `InvitationsPanel.cargar()` espera `Promise.all(...)`: hace falta un
  // segundo ciclo de estabilidad para que el `finally` que apaga `cargando`
  // se refleje en el DOM (mismo ajuste que `invitations-panel.spec.ts`).
  await avanzar(fixture);
}

describe('MembersPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lista los miembros con su rol, sin paginación cuando cabe en una página', async () => {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(pagina(1, 0));
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    expect(fixture.nativeElement.textContent).toContain('Persona De Prueba');
    expect(fixture.nativeElement.textContent).toContain('owner');
    expect(fixture.nativeElement.querySelector('nav.paginacion')).toBeNull();
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('la tabla usa app-data-table con caption y scroll alcanzable con teclado', async () => {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(pagina(1, 0));
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    const contenedor = fixture.nativeElement.querySelector('app-data-table') as HTMLElement | null;
    expect(contenedor).not.toBeNull();

    const tabla = contenedor!.querySelector('table') as HTMLTableElement;
    expect(tabla.querySelector('caption')?.textContent?.trim()).toBeTruthy();
    expect(tabla.querySelectorAll('th[scope="col"]').length).toBe(3);
    expect(tabla.querySelectorAll('tbody tr').length).toBe(1);

    const ranura = contenedor!.querySelector('.ranura-scroll') as HTMLElement;
    expect(ranura.getAttribute('tabindex')).toBe('0');
    expect(ranura.getAttribute('role')).toBe('region');
    expect(ranura.getAttribute('aria-label')).toBeTruthy();
  });

  it('muestra paginación cuando hay más de una página y pide la siguiente', async () => {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(pagina(25, 0));
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    expect(fixture.nativeElement.textContent).toContain('Página 1 de 2');

    const botonSiguiente = Array.from(
      fixture.nativeElement.querySelectorAll('nav.paginacion button'),
    ).find((boton) => (boton as HTMLButtonElement).textContent?.includes('Siguiente')) as
      HTMLButtonElement | undefined;
    botonSiguiente?.click();
    await avanzar(fixture);

    const peticion = http.expectOne(
      (peticion) => peticion.url === '/api/v1/organizations/me/members',
    );
    expect(peticion.request.params.get('offset')).toBe('20');
    peticion.flush(pagina(25, 20));
  });
  it('no tiene violaciones de accesibilidad en tema claro', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      const fixture = TestBed.createComponent(MembersPage);
      await avanzar(fixture);
      http
        .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
        .flush(pagina(1, 0));
      await avanzar(fixture);
      await flushPanelDeInvitaciones(http, fixture);

      await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('una persona con dos roles aparece una vez, con botón de quitar en cada uno', async () => {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(personaConDosRoles());
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    const filas = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(filas.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('organizer');
    expect(fixture.nativeElement.textContent).toContain('volunteer');
    expect(fixture.nativeElement.querySelectorAll('.quitar-rol').length).toBe(2);
  });

  it('con un solo rol no se puede quitar (no hay botón)', async () => {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(pagina(1, 0));
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    expect(fixture.nativeElement.querySelector('.quitar-rol')).toBeNull();
  });

  it('quitar un rol llama al endpoint y recarga la lista', async () => {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(personaConDosRoles());
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    const botonQuitar = fixture.nativeElement.querySelector('.quitar-rol') as HTMLButtonElement;
    botonQuitar.click();
    await avanzar(fixture);

    http.expectOne('/api/v1/organizations/me/members/m1').flush(null);
    await avanzar(fixture);

    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(pagina(1, 0));
    await avanzar(fixture);

    expect(fixture.nativeElement.textContent).toContain('Persona De Prueba');
  });
});

describe('MembersPage, ficha de un rol', () => {
  let http: HttpTestingController;

  function configurar(permisos: readonly string[], roles: readonly string[] = ['owner']): void {
    // jsdom no implementa el `<dialog>` modal (como en `media-edit-dialog.spec.ts`).
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
    }
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: authConPermisos(permisos, roles) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  const PONENTE = {
    items: [
      {
        user_id: 'u3',
        email: 'ponente@example.com',
        first_name: 'Pon',
        last_name: 'Ente',
        roles: [
          {
            id: 'm3',
            role_id: 'r3',
            role_key: 'speaker',
            role_name: 'Ponente',
            profile_fields: [
              {
                key: 'bio',
                label: 'Biografía',
                field_type: 'textarea',
                options: null,
                is_required: true,
              },
            ],
            profile_data: { bio: 'Antes.' },
            updated_at: '2026-10-19T10:00:00Z',
          },
        ],
        profile_data: {},
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  };

  async function cargar(): Promise<ComponentFixture<MembersPage>> {
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(PONENTE);
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);
    return fixture;
  }

  function botonEditar(fixture: ComponentFixture<MembersPage>): HTMLButtonElement | undefined {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((boton) => boton.textContent?.includes('Editar ficha'));
  }

  afterEach(() => {
    http.verify();
  });

  it('sin permiso para gestionar miembros no se ofrece', async () => {
    configurar(['members:read']);
    const fixture = await cargar();
    expect(botonEditar(fixture)).toBeUndefined();
  });

  it('el organizador la edita en un diálogo y la lista se recarga', async () => {
    configurar(TODOS_LOS_PERMISOS);
    const fixture = await cargar();

    botonEditar(fixture)!.click();
    await avanzar(fixture);
    // El último `<dialog>` es el de la ficha; antes va el de revocar invitaciones.
    const dialogos = (fixture.nativeElement as HTMLElement).querySelectorAll('dialog');
    const dialogo = dialogos[dialogos.length - 1]!;
    const area = dialogo.querySelector('textarea') as HTMLTextAreaElement;
    expect(dialogo.textContent).toContain('Ficha de Pon Ente (Ponente)');
    expect(area.value).toBe('Antes.');

    area.value = 'Después.';
    area.dispatchEvent(new Event('input'));
    (dialogo.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const guardar = http.expectOne('/api/v1/organizations/me/members/m3/profile');
    expect(guardar.request.body).toEqual({
      profile_data: { bio: 'Después.' },
      expected_updated_at: '2026-10-19T10:00:00Z',
    });
    guardar.flush({ profile_data: { bio: 'Después.' }, updated_at: '2026-10-19T11:00:00Z' });
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(PONENTE);
    await avanzar(fixture);
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);
  });

  it('el organizador guarda por partes, sin la biografía obligatoria', async () => {
    configurar(TODOS_LOS_PERMISOS);
    const fixture = await cargar();

    botonEditar(fixture)!.click();
    await avanzar(fixture);
    const dialogos = (fixture.nativeElement as HTMLElement).querySelectorAll('dialog');
    const dialogo = dialogos[dialogos.length - 1]!;
    const area = dialogo.querySelector('textarea') as HTMLTextAreaElement;
    area.value = '';
    area.dispatchEvent(new Event('input'));
    area.dispatchEvent(new Event('blur'));
    (dialogo.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    const guardar = http.expectOne('/api/v1/organizations/me/members/m3/profile');
    expect(guardar.request.body.profile_data).toEqual({ bio: '' });
    guardar.flush({ profile_data: {}, updated_at: '2026-10-19T11:00:00Z' });
    await avanzar(fixture);
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(PONENTE);
    await avanzar(fixture);
  });

  it('a quien no es propietario no le ofrece la ficha del propietario', async () => {
    configurar(TODOS_LOS_PERMISOS, ['organizer']);
    const fixture = TestBed.createComponent(MembersPage);
    await avanzar(fixture);
    const propietario = structuredClone(PONENTE);
    Object.assign(propietario.items[0]!.roles[0]!, { role_key: 'owner', role_name: 'Propietario' });
    http
      .expectOne((peticion) => peticion.url === '/api/v1/organizations/me/members')
      .flush(propietario);
    await avanzar(fixture);
    await flushPanelDeInvitaciones(http, fixture);

    expect(botonEditar(fixture)).toBeUndefined();
  });
});
