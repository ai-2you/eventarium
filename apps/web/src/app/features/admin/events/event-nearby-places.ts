import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/error.interceptor';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Card } from '../../../shared/ui/card';
import { Input } from '../../../shared/ui/input';
import { Select, type SelectOption } from '../../../shared/ui/select';

export const TIPOS_DE_SITIO = [
  'hotel',
  'restaurant',
  'bar',
  'parking',
  'transport',
  'pharmacy',
  'other',
] as const;
export type TipoDeSitio = (typeof TIPOS_DE_SITIO)[number];

interface SitioCercano {
  readonly id: string;
  readonly kind: TipoDeSitio;
  readonly custom_kind: string | null;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly notes: string | null;
}

interface OtroEvento {
  readonly id: string;
  readonly title: string;
}

/**
 * «Qué hay cerca» en la ficha del evento del panel: alojamiento, restaurantes,
 * parking… con dirección, teléfono, web y una nota. Se ordenan con las
 * flechas y se pueden copiar de otro evento de la organización (p. ej. la
 * edición anterior en el mismo sitio).
 */
@Component({
  selector: 'app-event-nearby-places',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, Alert, Button, Card, Input, Select],
  template: `
    <ng-container *transloco="let t; read: 'admin.events.cercanos'">
      <app-card [heading]="t('titulo')">
        <p class="ayuda">{{ t('ayuda') }}</p>
        @if (error(); as mensaje) {
          <app-alert tone="error">{{ mensaje }}</app-alert>
        }
        <div class="contenido">
          <div>
            @if (cargando()) {
              <p>{{ t('cargando') }}</p>
            } @else if (sitios().length === 0) {
              <p>{{ t('vacio') }}</p>
            } @else {
              <ol class="lista">
                @for (sitio of sitios(); track sitio.id; let i = $index, ultimo = $last) {
                  <li>
                    <div>
                      <strong>{{ sitio.name }}</strong>
                      <span class="detalle">
                        {{ sitio.kind === 'other' ? sitio.custom_kind : t('tipos.' + sitio.kind) }}
                        @if (sitio.address) {
                          · {{ sitio.address }}
                        }
                      </span>
                    </div>
                    <div class="acciones">
                      <app-button
                        variant="terciario"
                        [disabled]="i === 0"
                        [ariaLabel]="t('subir', { nombre: sitio.name })"
                        (pulsado)="mover(i, -1)"
                        >↑</app-button
                      >
                      <app-button
                        variant="terciario"
                        [disabled]="ultimo"
                        [ariaLabel]="t('bajar', { nombre: sitio.name })"
                        (pulsado)="mover(i, 1)"
                        >↓</app-button
                      >
                      <app-button variant="secundario" (pulsado)="editar(sitio)">
                        {{ t('editar') }}
                      </app-button>
                      <app-button variant="peligro" (pulsado)="borrar(sitio)">
                        {{ t('quitar') }}
                      </app-button>
                    </div>
                  </li>
                }
              </ol>
            }
            @if (otrosEventos().length > 0) {
              <div class="copiar">
                <app-select
                  fieldId="cercanos-copiar-de"
                  [label]="t('copiarDe')"
                  [placeholder]="t('eligeEvento')"
                  [options]="opcionesDeOtrosEventos()"
                  [(value)]="origen"
                />
                <app-button variant="secundario" [disabled]="!origen()" (pulsado)="copiar()">
                  {{ t('copiar') }}
                </app-button>
              </div>
            }
          </div>

          <form class="formulario" novalidate (submit)="guardar($event)">
            <h3>{{ editandoId() ? t('editarSitio') : t('anadirSitio') }}</h3>
            <app-select
              fieldId="cercano-tipo"
              [label]="t('tipo')"
              [options]="opcionesDeTipo()"
              [value]="tipo()"
              (valueChange)="tipo.set($any($event))"
            />
            @if (tipo() === 'other') {
              <app-input
                fieldId="cercano-tipo-libre"
                [label]="t('tipoLibre')"
                [hint]="t('tipoLibreAyuda')"
                [required]="true"
                [(value)]="tipoLibre"
              />
            }
            <app-input
              fieldId="cercano-nombre"
              [label]="t('nombre')"
              [required]="true"
              [(value)]="nombre"
            />
            <app-input fieldId="cercano-direccion" [label]="t('direccion')" [(value)]="direccion" />
            <app-input fieldId="cercano-telefono" [label]="t('telefono')" [(value)]="telefono" />
            <app-input
              fieldId="cercano-web"
              type="url"
              [label]="t('web')"
              [hint]="t('webAyuda')"
              [(value)]="web"
            />
            <app-input
              fieldId="cercano-nota"
              [label]="t('nota')"
              [hint]="t('notaAyuda')"
              [(value)]="nota"
            />
            @if (errorDeFormulario(); as mensaje) {
              <app-alert tone="error">{{ mensaje }}</app-alert>
            }
            <div class="acciones">
              <app-button type="submit" [loading]="guardando()">
                {{ editandoId() ? t('guardarCambios') : t('anadirSitio') }}
              </app-button>
              @if (editandoId()) {
                <app-button variant="terciario" (pulsado)="limpiar()">{{
                  t('cancelar')
                }}</app-button>
              }
            </div>
          </form>
        </div>
      </app-card>
    </ng-container>
  `,
  styles: `
    .ayuda {
      margin: 0 0 var(--sp-4);
      color: var(--muted);
    }
    .contenido {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
      gap: var(--sp-6);
      align-items: start;
    }
    .lista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--sp-3);
    }
    .lista li {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--sp-4);
    }
    .detalle {
      display: block;
      color: var(--muted);
      font-size: 0.875rem;
    }
    .acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--sp-2);
    }
    .copiar {
      display: grid;
      gap: var(--sp-2);
      margin-top: var(--sp-6);
      justify-items: start;
    }
    .formulario {
      display: grid;
      gap: var(--sp-4);
    }
    h3 {
      margin: 0;
    }
  `,
})
export class EventNearbyPlaces implements OnInit {
  readonly eventId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService);

  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errorDeFormulario = signal<string | null>(null);
  protected readonly sitios = signal<readonly SitioCercano[]>([]);
  protected readonly otrosEventos = signal<readonly OtroEvento[]>([]);
  protected readonly origen = signal('');
  protected readonly editandoId = signal<string | null>(null);

  protected readonly tipo = signal<TipoDeSitio>('hotel');
  protected readonly tipoLibre = signal('');
  protected readonly nombre = signal('');
  protected readonly direccion = signal('');
  protected readonly telefono = signal('');
  protected readonly web = signal('');
  protected readonly nota = signal('');

  protected readonly opcionesDeTipo = computed<SelectOption[]>(() =>
    TIPOS_DE_SITIO.map((tipo) => ({
      value: tipo,
      label: this.transloco.translate(`admin.events.cercanos.tipos.${tipo}`),
    })),
  );
  protected readonly opcionesDeOtrosEventos = computed<SelectOption[]>(() =>
    this.otrosEventos().map((evento) => ({ value: evento.id, label: evento.title })),
  );

  private url(sufijo = ''): string {
    return this.api.url(`/events/${this.eventId()}/nearby-places${sufijo}`);
  }

  ngOnInit(): void {
    void this.cargar();
    void this.cargarOtrosEventos();
  }

  private async cargar(): Promise<void> {
    try {
      this.sitios.set(await firstValueFrom(this.http.get<SitioCercano[]>(this.url())));
    } catch (error) {
      this.error.set(this.mensaje(error));
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarOtrosEventos(): Promise<void> {
    try {
      const pagina = await firstValueFrom(
        this.http.get<{ items: OtroEvento[] }>(this.api.url('/events'), {
          params: { limit: '100' },
        }),
      );
      this.otrosEventos.set(pagina.items.filter((evento) => evento.id !== this.eventId()));
    } catch {
      // Sin la lista de eventos solo se pierde «copiar de otro evento».
    }
  }

  protected editar(sitio: SitioCercano): void {
    this.editandoId.set(sitio.id);
    this.tipo.set(sitio.kind);
    this.tipoLibre.set(sitio.custom_kind ?? '');
    this.nombre.set(sitio.name);
    this.direccion.set(sitio.address ?? '');
    this.telefono.set(sitio.phone ?? '');
    this.web.set(sitio.website ?? '');
    this.nota.set(sitio.notes ?? '');
    this.errorDeFormulario.set(null);
  }

  protected limpiar(): void {
    this.editandoId.set(null);
    this.tipo.set('hotel');
    for (const campo of [
      this.tipoLibre,
      this.nombre,
      this.direccion,
      this.telefono,
      this.web,
      this.nota,
    ]) {
      campo.set('');
    }
    this.errorDeFormulario.set(null);
  }

  protected async guardar(evento: Event): Promise<void> {
    evento.preventDefault();
    if (!this.nombre().trim()) {
      this.errorDeFormulario.set(this.transloco.translate('admin.events.cercanos.faltaNombre'));
      return;
    }
    const opcional = (valor: string) => valor.trim() || null;
    const cuerpo = {
      kind: this.tipo(),
      custom_kind: this.tipo() === 'other' ? opcional(this.tipoLibre()) : null,
      name: this.nombre().trim(),
      address: opcional(this.direccion()),
      phone: opcional(this.telefono()),
      website: opcional(this.web()),
      notes: opcional(this.nota()),
    };
    this.guardando.set(true);
    this.errorDeFormulario.set(null);
    try {
      const id = this.editandoId();
      await firstValueFrom(
        id ? this.http.patch(this.url(`/${id}`), cuerpo) : this.http.post(this.url(), cuerpo),
      );
      this.limpiar();
      await this.cargar();
    } catch (error) {
      this.errorDeFormulario.set(this.mensaje(error));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async borrar(sitio: SitioCercano): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(this.url(`/${sitio.id}`)));
      if (this.editandoId() === sitio.id) this.limpiar();
      await this.cargar();
    } catch (error) {
      this.error.set(this.mensaje(error));
    }
  }

  protected async mover(indice: number, desplazamiento: number): Promise<void> {
    const ids = this.sitios().map((sitio) => sitio.id);
    const destino = indice + desplazamiento;
    [ids[indice], ids[destino]] = [ids[destino]!, ids[indice]!];
    try {
      this.sitios.set(
        await firstValueFrom(this.http.put<SitioCercano[]>(this.url('/order'), { ids })),
      );
    } catch (error) {
      this.error.set(this.mensaje(error));
    }
  }

  protected async copiar(): Promise<void> {
    try {
      this.sitios.set(
        await firstValueFrom(
          this.http.post<SitioCercano[]>(this.url(`/copy-from/${this.origen()}`), {}),
        ),
      );
      this.origen.set('');
    } catch (error) {
      this.error.set(this.mensaje(error));
    }
  }

  private mensaje(error: unknown): string {
    return error instanceof ApiError
      ? error.message
      : this.transloco.translate('admin.events.cercanos.error');
  }
}
