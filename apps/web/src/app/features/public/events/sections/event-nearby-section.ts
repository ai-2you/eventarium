import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

import type { PublicNearbyPlace } from '../event-page.types';

/** Orden de los grupos en la ficha: primero lo que más se busca. */
const ORDEN = ['hotel', 'restaurant', 'bar', 'parking', 'transport', 'pharmacy', 'other'] as const;

/** Trazos de Lucide (licencia ISC), 24×24, sin relleno. */
const ICONOS: Record<string, string> = {
  hotel: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
  restaurant:
    'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7',
  bar: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2',
  parking: 'M3 3h18v18H3zM9 17V7h4a3 3 0 0 1 0 6H9',
  transport:
    'M8 6v6M15 6v6M2 12h19.6M4 6h14a2 2 0 0 1 2 1.5l1.6 5.3c.3.9.4 1.3.4 2.2V18h-3M2 18V8a2 2 0 0 1 2-2M6 18h10M7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  pharmacy: 'M12 5v14M5 12h14',
  other:
    'M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
};

/**
 * «Qué hay cerca»: los sitios que el organizador señala, agrupados por tipo.
 * El teléfono es un enlace `tel:`, la web abre aparte y la dirección lleva a
 * mapas; los iconos son decorativos (el tipo va en el título del grupo).
 */
@Component({
  selector: 'app-event-nearby-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t; read: 'publico.eventos.cercanos'">
      <span class="rotulo-seccion">{{ t('rotulo') }}</span>
      <h2 id="cercanos-h2">{{ t('titulo') }}</h2>
      @for (grupo of grupos(); track grupo.tipo) {
        <section class="grupo" [attr.aria-labelledby]="'cercanos-' + grupo.tipo">
          <h3 [id]="'cercanos-' + grupo.tipo">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                [attr.d]="icono(grupo.tipo)"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ t('tipos.' + grupo.tipo) }}
          </h3>
          <ul>
            @for (sitio of grupo.sitios; track $index) {
              <li>
                <strong>{{ sitio.name }}</strong>
                @if (sitio.kind === 'other' && sitio.custom_kind) {
                  <span class="tipo">{{ sitio.custom_kind }}</span>
                }
                @if (sitio.address) {
                  <a
                    class="dato"
                    [href]="mapa(sitio)"
                    target="_blank"
                    rel="noopener noreferrer"
                    [attr.aria-label]="t('mapa', { nombre: sitio.name })"
                    >{{ sitio.address }}</a
                  >
                }
                @if (sitio.notes) {
                  <span class="dato nota">{{ sitio.notes }}</span>
                }
                <span class="enlaces">
                  @if (sitio.phone) {
                    <a
                      [href]="'tel:' + telefono(sitio.phone)"
                      [attr.aria-label]="t('llamar', { nombre: sitio.name })"
                      >{{ sitio.phone }}</a
                    >
                  }
                  @if (sitio.website) {
                    <a
                      [href]="sitio.website"
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      [attr.aria-label]="t('web', { nombre: sitio.name })"
                      >{{ dominio(sitio.website) }}</a
                    >
                  }
                </span>
              </li>
            }
          </ul>
        </section>
      }
    </ng-container>
  `,
  styles: `
    .grupo {
      margin-top: var(--space-md, 1rem);
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px;
      font-size: 1rem;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 12px;
    }
    li {
      display: grid;
      gap: 2px;
    }
    .tipo,
    .dato {
      color: var(--muted);
      font-size: 0.875rem;
    }
    .nota {
      font-style: italic;
    }
    .enlaces {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.875rem;
    }
  `,
})
export class EventNearbySection {
  readonly sitios = input.required<readonly PublicNearbyPlace[]>();

  protected readonly grupos = computed(() =>
    ORDEN.map((tipo) => ({
      tipo,
      sitios: this.sitios().filter((sitio) => sitio.kind === tipo),
    })).filter((grupo) => grupo.sitios.length > 0),
  );

  protected icono(tipo: string): string {
    return ICONOS[tipo] ?? ICONOS['other']!;
  }

  protected telefono(valor: string): string {
    return valor.replace(/[^\d+]/g, '');
  }

  protected mapa(sitio: PublicNearbyPlace): string {
    const destino = `${sitio.name}, ${sitio.address}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destino)}`;
  }

  protected dominio(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
