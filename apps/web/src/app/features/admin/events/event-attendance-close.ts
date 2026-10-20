import { DatePipe } from '@angular/common';
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

interface EstadoDelEvento {
  readonly ends_at: string;
  readonly status: string;
  readonly location_mode: string;
  readonly attendance_closed_at: string | null;
}

const PLAZO_PARA_REABRIR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cierre de la asistencia en la pantalla de check-in. Solo aparece cuando un
 * evento presencial o híbrido, publicado o archivado, ha terminado: cerrarla declara completo el check-in, y desde entonces
 * quien estaba confirmado y no se escaneó cuenta como ausencia. Pide una
 * confirmación en línea y se puede reabrir hasta 7 días después del evento.
 */
@Component({
  selector: 'app-event-attendance-close',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, DatePipe, Alert, Button],
  template: `
    <ng-container *transloco="let t; read: 'admin.events.checkIn.asistencia'">
      @if (terminado()) {
        <section class="asistencia" aria-labelledby="asistencia-titulo" aria-live="polite">
          <h2 id="asistencia-titulo">{{ t('titulo') }}</h2>
          @if (cerradaEl(); as fecha) {
            <p>{{ t('cerrada', { fecha: (fecha | date: 'medium') }) }}</p>
            @if (puedeReabrir()) {
              <app-button variant="secundario" [loading]="guardando()" (pulsado)="reabrir()">
                {{ t('reabrir') }}
              </app-button>
            }
          } @else if (confirmando()) {
            <p>{{ t('confirmacion') }}</p>
            <div class="acciones">
              <app-button [loading]="guardando()" (pulsado)="cerrar()">
                {{ t('confirmar') }}
              </app-button>
              <app-button variant="terciario" (pulsado)="confirmando.set(false)">
                {{ t('volver') }}
              </app-button>
            </div>
          } @else {
            <p>{{ t('sugerencia') }}</p>
            <app-button variant="secundario" (pulsado)="confirmando.set(true)">
              {{ t('cerrar') }}
            </app-button>
          }
          @if (error(); as mensaje) {
            <app-alert tone="error">{{ mensaje }}</app-alert>
          }
        </section>
      }
    </ng-container>
  `,
  styles: `
    .asistencia {
      display: grid;
      gap: var(--space-sm);
      justify-items: start;
      padding: var(--space-md);
      margin-bottom: var(--space-lg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
    }
    h2 {
      margin: 0;
      font-size: 1rem;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .acciones {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
    }
  `,
})
export class EventAttendanceClose implements OnInit {
  readonly eventId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);
  private readonly transloco = inject(TranslocoService);

  private readonly estado = signal<EstadoDelEvento | null>(null);
  protected readonly confirmando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly terminado = computed(() => {
    const estado = this.estado();
    return (
      estado !== null &&
      (estado.status === 'published' || estado.status === 'archived') &&
      estado.location_mode !== 'online' &&
      Date.now() >= new Date(estado.ends_at).getTime()
    );
  });
  protected readonly cerradaEl = computed(() => this.estado()?.attendance_closed_at ?? null);
  protected readonly puedeReabrir = computed(() => {
    const estado = this.estado();
    return (
      estado?.attendance_closed_at != null &&
      Date.now() - new Date(estado.ends_at).getTime() < PLAZO_PARA_REABRIR_MS
    );
  });

  ngOnInit(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    try {
      this.estado.set(
        await firstValueFrom(
          this.http.get<EstadoDelEvento>(this.api.url(`/events/${this.eventId()}`)),
        ),
      );
    } catch {
      // Sin el estado del evento no se ofrece el cierre: el check-in sigue igual.
    }
  }

  protected cerrar(): Promise<void> {
    return this.guardar('close');
  }

  protected reabrir(): Promise<void> {
    return this.guardar('reopen');
  }

  private async guardar(accion: 'close' | 'reopen'): Promise<void> {
    this.error.set(null);
    this.guardando.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.http.post<{ attendance_closed_at: string | null }>(
          this.api.url(`/events/${this.eventId()}/attendance/${accion}`),
          {},
        ),
      );
      const estado = this.estado();
      if (estado) {
        this.estado.set({ ...estado, attendance_closed_at: respuesta.attendance_closed_at });
      }
      this.confirmando.set(false);
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : this.transloco.translate('admin.events.checkIn.asistencia.error'),
      );
    } finally {
      this.guardando.set(false);
    }
  }
}
