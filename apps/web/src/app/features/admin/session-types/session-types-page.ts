import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/error.interceptor';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Card } from '../../../shared/ui/card';
import { Checkbox } from '../../../shared/ui/checkbox';
import { Dialog } from '../../../shared/ui/dialog';
import { Input } from '../../../shared/ui/input';
import { PageHeader } from '../../../shared/ui/page-header';
import {
  COLORES_DE_TIPO,
  type ColorDeTipo,
  SessionTypeChip,
  variableDeColor,
} from '../../../shared/ui/session-type-chip';
import { Textarea } from '../../../shared/ui/textarea';

/** Un tipo del catálogo (`GET /organizations/me/session-types`). */
export interface TipoDeSesion {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string;
  readonly is_break: boolean;
  readonly base_key: string | null;
  readonly display_order: number;
  readonly is_active: boolean;
  readonly sesiones: number;
}

const URL = '/organizations/me/session-types';

/**
 * Tipos de sesión de la organización (Charla, Taller, Mesa redonda…): crear,
 * editar, reordenar con botones (con teclado, sin arrastrar), desactivar los que
 * ya no se quieren ofrecer y borrar los que ninguna sesión usa.
 */
@Component({
  selector: 'app-session-types-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoDirective,
    Alert,
    Button,
    Card,
    Checkbox,
    Dialog,
    Input,
    PageHeader,
    SessionTypeChip,
    Textarea,
  ],
  template: `
    <ng-container *transloco="let t">
      <app-page-header [rotulo]="t('admin.tiposSesion.rotulo')">
        {{ t('admin.tiposSesion.cabeceraInicio') }}
        <span class="mark">{{ t('admin.tiposSesion.cabeceraMarca') }}</span>
        <div acciones>
          <app-button type="button" (pulsado)="abrirNuevo()">
            {{ t('admin.tiposSesion.nuevo') }}
          </app-button>
        </div>
      </app-page-header>

      <p class="intro">{{ t('admin.tiposSesion.intro') }}</p>

      @if (error(); as mensaje) {
        <app-alert tone="error">{{ mensaje }}</app-alert>
      }

      <p class="anuncio" aria-live="polite">{{ anuncio() }}</p>

      <app-card>
        @if (cargando()) {
          <p>{{ t('comun.cargando') }}</p>
        } @else {
          <ul class="tipos">
            @for (tipo of tipos(); track tipo.id) {
              <li [class.inactivo]="!tipo.is_active">
                <div class="datos">
                  <app-session-type-chip
                    [nombre]="tipo.name"
                    [color]="tipo.color"
                    [pausa]="tipo.is_break"
                  />
                  <span class="detalle">
                    @if (tipo.description) {
                      {{ tipo.description }} ·
                    }
                    @if (tipo.is_break) {
                      {{ t('admin.tiposSesion.esPausa') }} ·
                    }
                    {{ textoDeUsos(tipo.sesiones, t) }}
                    @if (!tipo.is_active) {
                      · <strong>{{ t('admin.tiposSesion.desactivado') }}</strong>
                    }
                  </span>
                </div>
                <div class="acciones">
                  <app-button
                    variant="terciario"
                    type="button"
                    [compacto]="true"
                    [ariaLabel]="t('admin.tiposSesion.subir', { nombre: tipo.name })"
                    (pulsado)="mover(tipo, -1)"
                    >↑</app-button
                  >
                  <app-button
                    variant="terciario"
                    type="button"
                    [compacto]="true"
                    [ariaLabel]="t('admin.tiposSesion.bajar', { nombre: tipo.name })"
                    (pulsado)="mover(tipo, 1)"
                    >↓</app-button
                  >
                  <app-button
                    variant="secundario"
                    type="button"
                    [compacto]="true"
                    [ariaLabel]="t('admin.tiposSesion.editarTipo', { nombre: tipo.name })"
                    (pulsado)="abrirEdicion(tipo)"
                  >
                    {{ t('admin.tiposSesion.editar') }}
                  </app-button>
                  <app-button
                    variant="secundario"
                    type="button"
                    [compacto]="true"
                    [disabled]="guardando()"
                    [ariaLabel]="
                      t(
                        tipo.is_active
                          ? 'admin.tiposSesion.desactivarTipo'
                          : 'admin.tiposSesion.activarTipo',
                        { nombre: tipo.name }
                      )
                    "
                    (pulsado)="alternarActivo(tipo)"
                  >
                    {{
                      tipo.is_active
                        ? t('admin.tiposSesion.desactivar')
                        : t('admin.tiposSesion.activar')
                    }}
                  </app-button>
                  @if (tipo.sesiones === 0) {
                    @if (confirmandoBorrado() === tipo.id) {
                      <!-- Borrar no se deshace: segundo paso explícito, como en Roles. -->
                      <app-button
                        variant="peligro"
                        type="button"
                        [compacto]="true"
                        [loading]="guardando()"
                        [ariaLabel]="t('admin.tiposSesion.confirmarBorrado', { nombre: tipo.name })"
                        (pulsado)="borrar(tipo)"
                      >
                        {{ t('admin.tiposSesion.seguro') }}
                      </app-button>
                      <app-button
                        variant="terciario"
                        type="button"
                        [compacto]="true"
                        (pulsado)="confirmandoBorrado.set(null)"
                      >
                        {{ t('comun.cancelar') }}
                      </app-button>
                    } @else {
                      <app-button
                        variant="peligro"
                        type="button"
                        [compacto]="true"
                        [disabled]="guardando()"
                        [ariaLabel]="t('admin.tiposSesion.borrarTipo', { nombre: tipo.name })"
                        (pulsado)="confirmandoBorrado.set(tipo.id)"
                      >
                        {{ t('admin.tiposSesion.borrar') }}
                      </app-button>
                    }
                  }
                </div>
              </li>
            }
          </ul>
        }
      </app-card>

      <app-dialog #dialogo (cerrado)="editando.set(null)">
        <h2 class="titulo-dialogo">
          {{
            editando()?.id
              ? t('admin.tiposSesion.editarTitulo')
              : t('admin.tiposSesion.nuevoTitulo')
          }}
        </h2>
        <form class="formulario" (submit)="guardar($event)" novalidate>
          <app-input
            fieldId="tipo-nombre"
            [label]="t('admin.tiposSesion.nombre')"
            [hint]="t('admin.tiposSesion.nombreAyuda')"
            [required]="true"
            [error]="errorNombre()"
            [(value)]="nombre"
          />
          <app-textarea
            fieldId="tipo-descripcion"
            [label]="t('admin.tiposSesion.descripcion')"
            [hint]="t('admin.tiposSesion.descripcionAyuda')"
            [rows]="2"
            [(value)]="descripcion"
          />
          <fieldset class="colores">
            <legend>{{ t('admin.tiposSesion.color') }}</legend>
            @for (color of colores; track color) {
              <label class="muestra" [style.--color]="cssDe(color)">
                <input
                  type="radio"
                  name="tipo-color"
                  [value]="color"
                  [checked]="colorElegido() === color"
                  (change)="colorElegido.set(color)"
                />
                <span class="punto" aria-hidden="true"></span>
                <span class="marca" aria-hidden="true">✓</span>
                <span class="nombre-color">{{ t('admin.tiposSesion.colores.' + color) }}</span>
              </label>
            }
          </fieldset>
          <app-checkbox
            fieldId="tipo-pausa"
            [label]="t('admin.tiposSesion.pausa')"
            [hint]="t('admin.tiposSesion.pausaAyuda')"
            [(checked)]="esPausa"
          />
          <div class="vista-previa">
            <span>{{ t('admin.tiposSesion.asiSeVera') }}</span>
            <app-session-type-chip
              [nombre]="nombre().trim() || t('admin.tiposSesion.nombre')"
              [color]="colorElegido()"
              [pausa]="esPausa()"
            />
          </div>
          @if (errorDialogo(); as mensaje) {
            <app-alert tone="error">{{ mensaje }}</app-alert>
          }
        </form>
        <app-button pie variant="secundario" type="button" (pulsado)="dialogo.cerrar()">
          {{ t('comun.cancelar') }}
        </app-button>
        <app-button pie type="button" [loading]="guardando()" (pulsado)="guardar()">
          {{ t('comun.guardar') }}
        </app-button>
      </app-dialog>
    </ng-container>
  `,
  styles: `
    .intro {
      color: var(--muted);
      max-width: 48rem;
    }
    .tipos {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
    }
    .tipos li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
      padding: var(--space-sm) 0;
      border-bottom: 1px solid var(--border);
    }
    .tipos li:last-child {
      border-bottom: none;
    }
    .datos {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm);
    }
    .detalle {
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .acciones {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
    }
    .titulo-dialogo {
      margin-top: 0;
    }
    .formulario {
      display: grid;
      gap: var(--space-md);
    }
    .colores {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      border: none;
      margin: 0;
      padding: 0;
    }
    .colores legend {
      margin-bottom: var(--space-xs);
      font-size: var(--fs-sm);
    }
    .muestra {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      cursor: pointer;
    }
    .muestra:has(input:checked) {
      border-color: var(--color);
      background-color: color-mix(in oklch, var(--color) 14%, transparent);
    }
    .muestra:has(input:focus-visible) {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .muestra input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    /* La elegida lleva ✓ y un borde de 2 px, no solo color: se distingue
       también con colores forzados del sistema. */
    .marca {
      display: none;
      font-size: var(--fs-sm);
    }
    .muestra:has(input:checked) {
      border-width: 2px;
    }
    .muestra:has(input:checked) .marca {
      display: inline;
    }
    @media (forced-colors: active) {
      .muestra:has(input:checked) {
        outline: 2px solid CanvasText;
      }
    }
    .anuncio {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .punto {
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 50%;
      background-color: var(--color);
    }
    .nombre-color {
      font-size: var(--fs-sm);
    }
    .vista-previa {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      color: var(--muted);
      font-size: var(--fs-sm);
    }
  `,
})
export class SessionTypesPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService);
  private readonly dialogo = viewChild.required<Dialog>('dialogo');
  private readonly anfitrion = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  protected readonly colores = COLORES_DE_TIPO;
  protected readonly cssDe = variableDeColor;

  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly tipos = signal<readonly TipoDeSesion[]>([]);
  protected readonly confirmandoBorrado = signal<string | null>(null);
  /** Lo que se anuncia a los lectores de pantalla tras reordenar. */
  protected readonly anuncio = signal('');

  /** El tipo del diálogo: `{}` para uno nuevo, el tipo para editarlo. */
  protected readonly editando = signal<Partial<TipoDeSesion> | null>(null);
  protected readonly nombre = signal('');
  protected readonly descripcion = signal('');
  protected readonly colorElegido = signal<ColorDeTipo>('azul');
  protected readonly esPausa = signal(false);
  protected readonly errorNombre = signal<string | null>(null);
  protected readonly errorDialogo = signal<string | null>(null);

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      this.tipos.set(await firstValueFrom(this.http.get<TipoDeSesion[]>(this.api.url(URL))));
    } catch (error) {
      this.error.set(this.mensajeDe(error));
    } finally {
      this.cargando.set(false);
    }
  }

  protected abrirNuevo(): void {
    this.abrir({}, '', '', 'azul', false);
  }

  protected abrirEdicion(tipo: TipoDeSesion): void {
    const color = (COLORES_DE_TIPO as readonly string[]).includes(tipo.color)
      ? (tipo.color as ColorDeTipo)
      : 'gris';
    this.abrir(tipo, tipo.name, tipo.description ?? '', color, tipo.is_break);
  }

  private abrir(
    tipo: Partial<TipoDeSesion>,
    nombre: string,
    descripcion: string,
    color: ColorDeTipo,
    pausa: boolean,
  ): void {
    this.editando.set(tipo);
    this.nombre.set(nombre);
    this.descripcion.set(descripcion);
    this.colorElegido.set(color);
    this.esPausa.set(pausa);
    this.errorNombre.set(null);
    this.errorDialogo.set(null);
    this.dialogo().abrir();
  }

  protected async guardar(evento?: Event): Promise<void> {
    evento?.preventDefault();
    const nombre = this.nombre().trim();
    if (!nombre) {
      this.errorNombre.set(this.transloco.translate('admin.tiposSesion.nombreRequerido'));
      return;
    }
    this.errorNombre.set(null);
    this.errorDialogo.set(null);
    const id = this.editando()?.id;
    const cuerpo = {
      name: nombre,
      description: this.descripcion().trim() || null,
      color: this.colorElegido(),
      is_break: this.esPausa(),
    };
    this.guardando.set(true);
    try {
      await firstValueFrom(
        id
          ? this.http.patch(this.api.url(`${URL}/${id}`), cuerpo)
          : this.http.post(this.api.url(URL), cuerpo),
      );
      this.dialogo().cerrar();
      await this.cargar();
    } catch (error) {
      this.errorDialogo.set(this.mensajeDe(error));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async alternarActivo(tipo: TipoDeSesion): Promise<void> {
    await this.ejecutar(() =>
      this.http.patch(this.api.url(`${URL}/${tipo.id}`), { is_active: !tipo.is_active }),
    );
  }

  protected async borrar(tipo: TipoDeSesion): Promise<void> {
    this.confirmandoBorrado.set(null);
    await this.ejecutar(() => this.http.delete(this.api.url(`${URL}/${tipo.id}`)));
  }

  /**
   * Sube o baja un puesto y envía el orden completo (la API lo exige entero).
   * Los botones no se desactivan (el foco caería al `<body>`): en los extremos o
   * mientras se guarda, el clic no hace nada. Después, el foco vuelve a la misma
   * flecha de esa fila y se anuncia el puesto nuevo.
   */
  protected async mover(tipo: TipoDeSesion, salto: -1 | 1): Promise<void> {
    if (this.guardando()) return;
    const ids = this.tipos().map((candidato) => candidato.id);
    const desde = ids.indexOf(tipo.id);
    const hasta = desde + salto;
    if (desde < 0 || hasta < 0 || hasta >= ids.length) return;
    [ids[desde], ids[hasta]] = [ids[hasta]!, ids[desde]!];
    await this.ejecutar(() => this.http.put(this.api.url(`${URL}/order`), { ids }));
    this.anuncio.set(
      this.transloco.translate('admin.tiposSesion.nuevoPuesto', {
        nombre: tipo.name,
        puesto: hasta + 1,
        total: ids.length,
      }),
    );
    const etiqueta = this.transloco.translate(
      salto < 0 ? 'admin.tiposSesion.subir' : 'admin.tiposSesion.bajar',
      { nombre: tipo.name },
    );
    afterNextRender(
      () =>
        (
          this.anfitrion.nativeElement.querySelector(
            `button[aria-label="${CSS.escape(etiqueta)}"]`,
          ) as HTMLElement | null
        )?.focus(),
      { injector: this.injector },
    );
  }

  private async ejecutar(peticion: () => ReturnType<HttpClient['delete']>): Promise<void> {
    this.error.set(null);
    this.guardando.set(true);
    try {
      await firstValueFrom(peticion());
    } catch (error) {
      this.error.set(this.mensajeDe(error));
    } finally {
      this.guardando.set(false);
      await this.cargar();
    }
  }

  protected textoDeUsos(n: number, traducir: (clave: string, p?: object) => string): string {
    if (n === 0) return traducir('admin.tiposSesion.usosNinguna');
    if (n === 1) return traducir('admin.tiposSesion.usosUna');
    return traducir('admin.tiposSesion.usos', { n });
  }

  private mensajeDe(error: unknown): string {
    return error instanceof ApiError
      ? error.message
      : this.transloco.translate('admin.tiposSesion.error');
  }
}
