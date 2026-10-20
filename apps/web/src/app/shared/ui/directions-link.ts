import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * «Cómo llegar»: abre Google Maps con la ruta hasta el lugar desde la
 * ubicación de quien lo pulsa (en el móvil abre la app, o la web). El destino
 * va como texto (nombre y dirección): Google lo sitúa mejor que las
 * coordenadas que da nuestro geocodificador. Solo con coordenadas si no hay
 * dirección. Sin detectar el sistema: el mismo HTML en servidor y navegador.
 */
@Component({
  selector: 'app-directions-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      @if (url(); as destino) {
        <a
          class="como-llegar"
          [href]="destino"
          target="_blank"
          rel="noopener noreferrer"
          [attr.aria-label]="
            t('publico.eventos.comoLlegar.aria', { lugar: lugar() || direccion() })
          "
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <polygon
              points="3 11 22 2 13 21 11 13 3 11"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            />
          </svg>
          {{ t('publico.eventos.comoLlegar.texto') }}
        </a>
      }
    </ng-container>
  `,
  styles: `
    .como-llegar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
  `,
})
export class DirectionsLink {
  readonly lugar = input<string | null>(null);
  readonly direccion = input<string | null>(null);
  readonly latitud = input<number | null>(null);
  readonly longitud = input<number | null>(null);

  protected readonly url = computed(() => {
    const direccion = this.direccion()?.trim();
    const lugar = this.lugar()?.trim();
    let destino: string | null = null;
    if (direccion) {
      destino = lugar && !direccion.includes(lugar) ? `${lugar}, ${direccion}` : direccion;
    } else if (this.latitud() !== null && this.longitud() !== null) {
      destino = `${this.latitud()},${this.longitud()}`;
    }
    return destino === null
      ? null
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
  });
}
