import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/error.interceptor';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Select, type SelectOption } from '../../../shared/ui/select';
import type { EventSession } from './session-form';
import { type Participacion, opcionesDeRol, solapesDe } from './session-roles';

interface ParticipanteDeSesion {
  readonly event_member_id: string;
  readonly role_key: string;
}

/**
 * Asignar un ponente a una sesión de la agenda sin salir de la pantalla de
 * ponentes. Añade a la persona a la lista de la sesión sin quitar a nadie: el
 * `PUT` de participantes reemplaza la lista entera, así que se lee primero la
 * versión de la sesión y después su lista, y se envía esa versión; si otra
 * persona guardó entretanto, la API responde 409 y se vuelve a cargar.
 */
@Component({
  selector: 'app-speaker-session-assign',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, TranslocoDirective, Alert, Button, Select],
  template: `
    <ng-container *transloco="let t">
      @if (cargando()) {
        <p>{{ t('comun.cargando') }}</p>
      } @else if (sesiones().length === 0) {
        <p>{{ t('admin.events.speakers.asignar.sinSesiones') }}</p>
        <a [routerLink]="['/dashboard/events', eventId(), 'agenda']">
          {{ t('admin.events.speakers.asignar.crearSesion') }}
        </a>
      } @else {
        <div class="asignar">
          @if (sesionesActuales().length > 0) {
            <p>
              {{ t('admin.events.speakers.asignar.yaEsta') }}
              @for (sesion of sesionesActuales(); track sesion.id; let ultima = $last) {
                <strong>{{ sesion.title }}</strong> ({{ sesion.starts_at | date: 'short' }}){{
                  ultima ? '.' : ','
                }}
              }
            </p>
          }
          <app-select
            fieldId="asignar-sesion"
            [label]="t('admin.events.speakers.asignar.sesion')"
            [placeholder]="t('admin.events.speakers.asignar.eligeSesion')"
            [options]="opcionesDeSesion()"
            [(value)]="sesionElegida"
          />
          <p class="solape" aria-live="polite">{{ avisoDeSolape() }}</p>
          <app-select
            fieldId="asignar-rol"
            [label]="t('admin.events.speakers.asignar.rol')"
            [options]="opcionesDeRol()"
            [(value)]="rol"
          />
          @if (error(); as mensaje) {
            <app-alert tone="error">{{ mensaje }}</app-alert>
          }
          @if (exito(); as mensaje) {
            <app-alert tone="exito">{{ mensaje }}</app-alert>
          }
          <div class="acciones">
            <a [routerLink]="['/dashboard/events', eventId(), 'agenda']">
              {{ t('admin.events.speakers.asignar.crearSesion') }}
            </a>
            <app-button
              type="button"
              [loading]="guardando()"
              [disabled]="!sesionElegida()"
              (pulsado)="asignar()"
            >
              {{ t('admin.events.speakers.asignar.guardar') }}
            </app-button>
          </div>
        </div>
      }
    </ng-container>
  `,
  styles: `
    .asignar {
      display: grid;
      gap: var(--space-md);
    }
    .solape:empty {
      display: none;
    }
    .acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
    }
  `,
})
export class SpeakerSessionAssign implements OnInit {
  readonly eventId = input.required<string>();
  readonly eventMemberId = input.required<string>();

  /** Tras asignar: quien lo usa recarga su tabla de ponentes. */
  readonly asignado = output<void>();

  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService);
  private readonly formatoFecha = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly sesiones = signal<readonly EventSession[]>([]);
  private readonly participaciones = signal<readonly Participacion[]>([]);
  protected readonly sesionElegida = signal('');
  protected readonly rol = signal('speaker');

  protected readonly sesionesActuales = computed(() => {
    const ids = new Set(
      this.participaciones()
        .filter((participacion) => participacion.event_member_id === this.eventMemberId())
        .map((participacion) => participacion.session_id),
    );
    return this.sesiones().filter((sesion) => ids.has(sesion.id));
  });

  protected readonly opcionesDeSesion = computed<SelectOption[]>(() =>
    this.sesiones().map((sesion) => ({
      value: sesion.id,
      label: `${sesion.title} · ${this.formatoFecha.format(new Date(sesion.starts_at))}`,
    })),
  );

  // Aquí se asigna: «No participa» no es una opción (enviaría un rol vacío).
  protected readonly opcionesDeRol = computed(() =>
    opcionesDeRol((clave) => this.transloco.translate(clave), '').filter(
      (opcion) => opcion.value !== '',
    ),
  );

  protected readonly avisoDeSolape = computed(() => {
    const sesion = this.sesiones().find((candidata) => candidata.id === this.sesionElegida());
    if (!sesion) return null;
    const solapes = solapesDe(this.eventMemberId(), sesion, this.participaciones());
    if (solapes.length === 0) return null;
    return this.transloco.translate('admin.events.agenda.participantes.solape', {
      sesiones: solapes.map((solape) => `«${solape.session_title}»`).join(', '),
    });
  });

  ngOnInit(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      const [sesiones, participaciones] = await Promise.all([
        firstValueFrom(
          this.http.get<EventSession[]>(this.api.url(`/events/${this.eventId()}/sessions`)),
        ),
        firstValueFrom(
          this.http.get<Participacion[]>(this.api.url(`/events/${this.eventId()}/participations`)),
        ),
      ]);
      this.sesiones.set(sesiones);
      this.participaciones.set(participaciones);
    } catch (error) {
      this.error.set(this.mensajeDe(error));
    } finally {
      this.cargando.set(false);
    }
  }

  protected async asignar(): Promise<void> {
    const sesionId = this.sesionElegida();
    if (!sesionId) return;
    this.error.set(null);
    this.exito.set(null);
    this.guardando.set(true);
    try {
      // La versión, antes que la lista: si alguien guarda entre las dos lecturas,
      // la versión leída ya es vieja y la API rechaza el guardado (409).
      const sesiones = await firstValueFrom(
        this.http.get<EventSession[]>(this.api.url(`/events/${this.eventId()}/sessions`)),
      );
      const sesion = sesiones.find((candidata) => candidata.id === sesionId);
      if (!sesion) {
        this.error.set(this.transloco.translate('admin.events.speakers.asignar.yaNoExiste'));
        this.sesiones.set(sesiones);
        return;
      }
      const url = this.api.url(`/events/${this.eventId()}/sessions/${sesionId}/participants`);
      const actuales = await firstValueFrom(this.http.get<ParticipanteDeSesion[]>(url));
      const yaAsignado = actuales.some(
        (participante) =>
          participante.event_member_id === this.eventMemberId() &&
          participante.role_key === this.rol(),
      );
      if (yaAsignado) {
        this.error.set(this.transloco.translate('admin.events.speakers.asignar.yaAsignado'));
        return;
      }
      await firstValueFrom(
        this.http.put(url, {
          expected_updated_at: sesion.updated_at,
          participants: [
            ...actuales.map(({ event_member_id, role_key }) => ({ event_member_id, role_key })),
            { event_member_id: this.eventMemberId(), role_key: this.rol() },
          ],
        }),
      );
      this.exito.set(
        this.transloco.translate('admin.events.speakers.asignar.hecho', { sesion: sesion.title }),
      );
      this.sesionElegida.set('');
      this.asignado.emit();
      await this.cargar();
    } catch (error) {
      this.error.set(this.mensajeDe(error));
      if (error instanceof ApiError && error.status === 409) {
        await this.cargar();
      }
    } finally {
      this.guardando.set(false);
    }
  }

  private mensajeDe(error: unknown): string {
    return error instanceof ApiError
      ? error.message
      : this.transloco.translate('admin.events.speakers.asignar.error');
  }
}
