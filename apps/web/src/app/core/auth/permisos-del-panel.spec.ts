import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { AuthService, type UsuarioAutenticado } from './auth.service';
import { routes } from '../../app.routes';
import { REQUISITOS_DEL_PANEL, cumpleRequisito, requierePermiso } from './permisos-del-panel';

describe('cumpleRequisito', () => {
  const ponente = ['organizations:read'];
  const organizador = ['organizations:read', 'events:read', 'events:write'];

  it('«gestion» excluye a quien solo puede ver la organización', () => {
    expect(cumpleRequisito('gestion', ponente, ['speaker'])).toBe(false);
    expect(cumpleRequisito('gestion', organizador, ['organizer'])).toBe(true);
  });

  it('permiso, cualquiera de varios, rol y ninguno', () => {
    expect(cumpleRequisito({ permiso: 'events:read' }, organizador, [])).toBe(true);
    expect(cumpleRequisito({ permiso: 'roles:read' }, organizador, [])).toBe(false);
    expect(cumpleRequisito({ cualquiera: ['x', 'events:write'] }, organizador, [])).toBe(true);
    expect(cumpleRequisito({ rol: 'owner' }, organizador, ['organizer'])).toBe(false);
    expect(cumpleRequisito({ rol: 'owner' }, [], ['owner'])).toBe(true);
    expect(cumpleRequisito('ninguno', [], [])).toBe(true);
  });
});

describe('requierePermiso', () => {
  function ejecutar(usuario: Partial<UsuarioAutenticado> | Error): Promise<boolean | UrlTree> {
    const asegurar = vi.fn(async () => {
      if (usuario instanceof Error) throw usuario;
      return usuario as UsuarioAutenticado;
    });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { asegurarUsuarioCompleto: asegurar } },
      ],
    });
    const guard = requierePermiso({ permiso: 'roles:read' });
    return TestBed.runInInjectionContext(
      () =>
        guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot) as Promise<
          boolean | UrlTree
        >,
    );
  }

  it('espera a tener los permisos y deja pasar si se cumple', async () => {
    expect(await ejecutar({ permissions: ['roles:read'], roles: [] })).toBe(true);
  });

  it('sin el permiso lleva a la ficha propia', async () => {
    const resultado = await ejecutar({ permissions: ['organizations:read'], roles: ['speaker'] });
    expect(TestBed.inject(Router).serializeUrl(resultado as UrlTree)).toBe('/dashboard/account');
  });

  it('si no se pueden cargar los permisos deja pasar y decide el backend', async () => {
    expect(await ejecutar(new Error('sin red'))).toBe(true);
  });
});

describe('REQUISITOS_DEL_PANEL', () => {
  it('toda ruta hija de /dashboard tiene requisito y guard', () => {
    const panel = routes.find((ruta) => ruta.path === 'dashboard');
    const claves: string[] = [];
    const sinGuard: string[] = [];
    for (const hija of panel?.children ?? []) {
      claves.push(hija.path ?? '');
      if (!hija.canActivate?.length) sinGuard.push(hija.path ?? '');
      for (const nieta of hija.children ?? []) {
        if (nieta.path === '') continue;
        const clave = `${hija.path}/${nieta.path}`;
        claves.push(clave);
        if (!nieta.canActivate?.length) sinGuard.push(clave);
      }
    }
    const sinRequisito = claves.filter((clave) => !(clave in REQUISITOS_DEL_PANEL));
    expect(sinRequisito).toEqual([]);
    expect(sinGuard).toEqual([]);
  });
});
