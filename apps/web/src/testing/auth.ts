import { computed, signal } from '@angular/core';

/** Todos los permisos del catálogo (`app/core/permissions.py`): lo que tiene
 * el propietario de una organización. */
export const TODOS_LOS_PERMISOS: readonly string[] = [
  'organizations:read',
  'organizations:write',
  'branding:write',
  'roles:read',
  'roles:write',
  'members:read',
  'members:write',
  'users:read',
  'events:read',
  'events:write',
  'registrations:read',
  'registrations:write',
  'tickets:read',
  'tickets:write',
  'sponsors:read',
  'sponsors:write',
  'payments:read',
  'payments:write',
  'accounting:read',
  'accounting:write',
  'invitations:manage',
  'mcp:connect',
];

/** `AuthService` simulado con los permisos y roles indicados (por defecto, los
 * del propietario), para los specs del panel que filtran por permisos. */
export function authConPermisos(
  permisos: readonly string[] = TODOS_LOS_PERMISOS,
  roles: readonly string[] = ['owner'],
  usuario: Record<string, unknown> = {},
) {
  const actual = signal({ is_superadmin: false, ...usuario, permissions: permisos, roles });
  return {
    currentUser: actual,
    permisos: computed(() => actual().permissions),
    roles: computed(() => actual().roles),
    asegurarUsuarioCompleto: async () => actual(),
  };
}
