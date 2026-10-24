import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/error.interceptor';
import { AuthService, displayName } from '../../../core/auth/auth.service';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { DataTable, DataTableColumn } from '../../../shared/ui/data-table';
import { Dialog } from '../../../shared/ui/dialog';
import { ProfileField } from '../../../shared/ui/dynamic-field.model';
import { PageHeader } from '../../../shared/ui/page-header';
import { InvitationsPanel } from './invitations-panel';
import { FichaGuardada, MemberProfileForm } from './member-profile-form';

interface MemberRole {
  readonly id: string;
  readonly role_id: string;
  readonly role_key: string;
  readonly role_name: string;
  readonly profile_fields?: readonly ProfileField[];
  readonly profile_data?: Record<string, unknown>;
  readonly updated_at?: string | null;
}

/** La ficha que se está editando en el diálogo: de quién y de qué rol. */
interface FichaAbierta {
  readonly persona: string;
  readonly rol: MemberRole;
}

interface Member {
  readonly user_id: string;
  readonly email: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly roles: readonly MemberRole[];
  readonly profile_data: Record<string, unknown>;
}

interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

const LIMITE = 20;

/** Lista paginada de miembros de la organización, con su rol y datos de perfil. */
@Component({
  selector: 'app-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoDirective,
    RouterLink,
    Alert,
    Button,
    DataTable,
    Dialog,
    PageHeader,
    InvitationsPanel,
    MemberProfileForm,
  ],
  template: `
    <ng-container *transloco="let t">
      <app-page-header [rotulo]="t('admin.members.titulo')">
        {{ t('admin.members.cabeceraInicio') }}
        <span class="mark">{{ t('admin.members.cabeceraMarca') }}</span>
        <div acciones>
          <a routerLink="nuevo">
            <app-button type="button">{{ t('admin.members.anadirMiembro') }}</app-button>
          </a>
        </div>
      </app-page-header>

      @if (error(); as mensaje) {
        <app-alert tone="error">{{ mensaje }}</app-alert>
      }

      @if (cargando()) {
        <p>{{ t('comun.cargando') }}</p>
      } @else if (miembros().length === 0) {
        <p>{{ t('admin.members.sinMiembros') }}</p>
      } @else {
        <app-data-table [columnas]="columnasDeMiembros()" [caption]="t('admin.members.titulo')">
          @for (miembro of miembros(); track miembro.user_id) {
            <tr>
              <td>{{ nombreDe(miembro) }}</td>
              <td>{{ miembro.email }}</td>
              <td>
                <ul class="roles-persona">
                  @for (rol of miembro.roles; track rol.id) {
                    <li>
                      <code>{{ rol.role_key }}</code>
                      @if (puedeEditarFicha(rol)) {
                        <button
                          type="button"
                          class="editar-ficha"
                          [attr.aria-label]="
                            t('admin.members.ficha.editarAria', {
                              persona: nombreDe(miembro),
                              rol: rol.role_name,
                            })
                          "
                          (click)="abrirFicha(miembro, rol)"
                        >
                          {{ t('admin.members.ficha.editar') }}
                        </button>
                      }
                      @if (miembro.roles.length > 1) {
                        <button
                          type="button"
                          class="quitar-rol"
                          [attr.aria-label]="t('admin.members.quitarRol', { rol: rol.role_name })"
                          [disabled]="quitandoRolId() === rol.id"
                          (click)="quitarRol(rol.id)"
                        >
                          &times;
                        </button>
                      }
                    </li>
                  }
                </ul>
              </td>
            </tr>
          }
        </app-data-table>

        @if (totalPaginas() > 1) {
          <nav [attr.aria-label]="t('admin.members.titulo')" class="paginacion">
            <app-button
              variant="secundario"
              type="button"
              [disabled]="offset() === 0"
              (pulsado)="irAPagina(offset() - limite)"
            >
              {{ t('admin.members.anterior') }}
            </app-button>
            <span>
              {{ t('admin.members.paginaDe', { actual: paginaActual(), total: totalPaginas() }) }}
            </span>
            <app-button
              variant="secundario"
              type="button"
              [disabled]="offset() + limite >= total()"
              (pulsado)="irAPagina(offset() + limite)"
            >
              {{ t('admin.members.siguiente') }}
            </app-button>
          </nav>
        }
      }

      <app-invitations-panel />

      <app-dialog #dialogoFicha (cerrado)="fichaAbierta.set(null)">
        @if (fichaAbierta(); as ficha) {
          <h2>
            {{
              t('admin.members.ficha.titulo', { persona: ficha.persona, rol: ficha.rol.role_name })
            }}
          </h2>
          <app-member-profile-form
            prefijo="ficha-miembro"
            [organizationMemberId]="ficha.rol.id"
            [campos]="ficha.rol.profile_fields ?? []"
            [datos]="ficha.rol.profile_data ?? {}"
            [updatedAt]="ficha.rol.updated_at ?? null"
            [exigirObligatorios]="false"
            (guardado)="alGuardarFicha($event)"
          />
        }
        <app-button pie variant="secundario" type="button" (pulsado)="dialogoFicha.cerrar()">
          {{ t('comun.cerrar') }}
        </app-button>
      </app-dialog>
    </ng-container>
  `,
  styles: `
    .paginacion {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-md);
      margin-top: var(--space-md);
    }
    .roles-persona {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    .roles-persona li {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .quitar-rol {
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      padding: 0 2px;
    }
    .editar-ficha {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-size: var(--text-sm, 0.875rem);
      padding: 0 2px;
      text-decoration: underline;
    }
    .quitar-rol:hover {
      color: var(--danger);
    }
    .quitar-rol:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `,
})
export class MembersPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService);
  private readonly auth = inject(AuthService);
  private readonly dialogoFicha = viewChild.required<Dialog>('dialogoFicha');

  protected readonly cargando = signal(true);
  protected readonly miembros = signal<Member[]>([]);
  protected readonly total = signal(0);
  protected readonly offset = signal(0);
  protected readonly limite = LIMITE;
  protected readonly error = signal<string | null>(null);
  protected readonly quitandoRolId = signal<string | null>(null);
  protected readonly fichaAbierta = signal<FichaAbierta | null>(null);
  private readonly puedeEditarFichas = computed(
    () => this.auth.permisos()?.includes('members:write') ?? false,
  );

  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / LIMITE)));
  protected readonly paginaActual = computed(() => Math.floor(this.offset() / LIMITE) + 1);
  protected readonly nombreDe = displayName;

  /** Las columnas de la tabla de miembros, con la etiqueta ya traducida. */
  protected readonly columnasDeMiembros = computed<DataTableColumn[]>(() => {
    const t = (clave: string): string => this.transloco.translate(clave);
    return [
      { key: 'nombre', label: t('admin.members.columnaNombre') },
      { key: 'correo', label: t('admin.members.columnaCorreo') },
      { key: 'rol', label: t('admin.members.columnaRol') },
    ];
  });

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const pagina = await firstValueFrom(
        this.http.get<Page<Member>>(this.api.url('/organizations/me/members'), {
          params: { limit: LIMITE, offset: this.offset() },
        }),
      );
      this.miembros.set([...pagina.items]);
      this.total.set(pagina.total);
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message : this.transloco.translate('admin.members.error'),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  protected irAPagina(nuevoOffset: number): void {
    this.offset.set(Math.max(0, nuevoOffset));
    void this.cargar();
  }

  /** El backend decide (rango del rol incluido); esto solo evita ofrecer un 403:
   * la ficha del propietario solo la toca otro propietario. */
  protected puedeEditarFicha(rol: MemberRole): boolean {
    if (!this.puedeEditarFichas() || !rol.profile_fields?.length) return false;
    return rol.role_key !== 'owner' || (this.auth.roles()?.includes('owner') ?? false);
  }

  protected abrirFicha(miembro: Member, rol: MemberRole): void {
    this.fichaAbierta.set({ persona: displayName(miembro), rol });
    this.dialogoFicha().abrir();
  }

  /** Deja la versión nueva en la fila ya mismo (reabrir el diálogo antes de que
   * vuelva la lista no debe partir de la vieja y dar 409) y recarga la lista. */
  protected alGuardarFicha(ficha: FichaGuardada): void {
    const rolId = this.fichaAbierta()?.rol.id;
    this.miembros.update((miembros) =>
      miembros.map((miembro) => ({
        ...miembro,
        roles: miembro.roles.map((rol) =>
          rol.id === rolId
            ? { ...rol, profile_data: ficha.profile_data, updated_at: ficha.updated_at }
            : rol,
        ),
      })),
    );
    void this.cargar();
  }

  /** Quita un rol concreto (no a la persona). El botón ya está deshabilitado
   * cuando es el único rol; el 409 del servidor es la misma regla por si
   * llega una fila obsoleta (otra pestaña, otra persona quitando a la vez). */
  protected async quitarRol(organizationMemberId: string): Promise<void> {
    this.error.set(null);
    this.quitandoRolId.set(organizationMemberId);
    try {
      await firstValueFrom(
        this.http.delete(this.api.url(`/organizations/me/members/${organizationMemberId}`)),
      );
      await this.cargar();
    } catch (error) {
      this.error.set(
        error instanceof ApiError ? error.message : this.transloco.translate('admin.members.error'),
      );
    } finally {
      this.quitandoRolId.set(null);
    }
  }
}
