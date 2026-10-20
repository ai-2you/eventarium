import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Claves de la paleta cerrada (`session_types.PALETA` en la API). */
export const COLORES_DE_TIPO = [
  'azul',
  'violeta',
  'verde',
  'ambar',
  'rosa',
  'cian',
  'rojo',
  'gris',
] as const;

export type ColorDeTipo = (typeof COLORES_DE_TIPO)[number];

/** Una clave desconocida (dato antiguo) cae en gris en vez de quedar sin color. */
export function variableDeColor(color: string): string {
  const clave = (COLORES_DE_TIPO as readonly string[]).includes(color) ? color : 'gris';
  return `var(--tipo-${clave})`;
}

/**
 * Chip del tipo de una sesión, con el color que eligió la organización. El
 * nombre siempre va escrito: el color solo lo refuerza.
 */
@Component({
  selector: 'app-session-type-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="chip"
    [class.pausa]="pausa()"
    [class.compacto]="compacto()"
    [style.--color]="colorCss()"
    >{{ nombre() }}</span
  >`,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border: 1px solid color-mix(in oklch, var(--color) 55%, transparent);
      border-radius: 999px;
      background-color: color-mix(in oklch, var(--color) 14%, transparent);
      color: var(--color);
      font-size: var(--fs-sm, 0.8125rem);
      line-height: 1.5;
      white-space: nowrap;
    }
    .pausa {
      border-style: dashed;
    }
    /* Junto a un título (agenda del panel): acompaña sin competir con él. */
    .compacto {
      padding: 0 6px;
      font-size: 0.6875rem;
      line-height: 1.45;
    }
  `,
})
export class SessionTypeChip {
  readonly nombre = input.required<string>();
  readonly color = input('gris');
  readonly pausa = input(false);
  readonly compacto = input(false);

  protected readonly colorCss = computed(() => variableDeColor(this.color()));
}
