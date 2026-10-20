import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  type OnInit,
  type ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../core/api/api.service';
import { ApiError } from '../../../core/api/error.interceptor';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';

/** `GET /events/{id}/attendance`: con el mismo permiso que el check-in. */
interface EstadoDeAsistencia {
  readonly ends_at: string;
  readonly can_close: boolean;
  readonly attendance_closed_at: string | null;
}

const PLAZO_PARA_REABRIR_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cierre de la asistencia en la pantalla de check-in. Solo aparece cuando un
 * evento presencial, publicado o archivado, ha terminado: cerrarla declara completo el check-in, y desde entonces
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
        <section class="asistencia" aria-labelledby="asistencia-titulo">
          <h2 id="asistencia-titulo" tabindex="-1" #titulo>{{ t('titulo') }}</h2>
          @if (cerradaEl(); as fecha) {
            <p role="status">{{ t('cerrada', { fecha: (fecha | date: 'medium') }) }}</p>
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
              <app-button variant="terciario" (pulsado)="confirmar(false)">
                {{ t('volver') }}
              </app-button>
            </div>
          } @else {
            <p>{{ t('sugerencia') }}</p>
            <app-button variant="secundario" (pulsado)="confirmar(true)">
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
    h2:focus {
      outline: none;
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

  private readonly estado = signal<EstadoDeAsistencia | null>(null);
  private readonly titulo = viewChild<ElementRef<HTMLElement>>('titulo');
  protected readonly confirmando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly terminado = computed(() => {
    const estado = this.estado();
    return estado !== null && estado.can_close && Date.now() >= new Date(estado.ends_at).getTime();
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
          this.http.get<EstadoDeAsistencia>(this.api.url(`/events/${this.eventId()}/attendance`)),
        ),
      );
    } catch {
      // Sin el estado del evento no se ofrece el cierre: el check-in sigue igual.
    }
  }

  /** Cada paso sustituye al botón pulsado: el foco vuelve al título del bloque. */
  protected confirmar(si: boolean): void {
    this.confirmando.set(si);
    this.enfocar();
  }

  private enfocar(): void {
    setTimeout(() => this.titulo()?.nativeElement.focus());
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
        this.http.post<EstadoDeAsistencia>(
          this.api.url(`/events/${this.eventId()}/attendance/${accion}`),
          {},
        ),
      );
      this.estado.set(respuesta);
      this.confirmando.set(false);
      this.enfocar();
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
