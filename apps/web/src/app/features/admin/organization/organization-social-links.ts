import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

import { Input } from '../../../shared/ui/input';

/** Redes con icono propio; mismo conjunto que `SocialKind` en la API. */
export const REDES = ['linkedin', 'instagram', 'x', 'facebook', 'youtube', 'tiktok'] as const;
export type Red = (typeof REDES)[number];

export interface EnlaceSocial {
  readonly kind: Red | 'other';
  readonly url: string;
  readonly label?: string | null;
}

const NOMBRES: Record<Red, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

/**
 * Las redes de la organización en su ficha: un campo por red (vacío = no la
 * tiene) y un enlace libre con su nombre (Mastodon, Bluesky, Discord…).
 * `enlaces` es la lista que se envía a la API, ya sin los vacíos.
 */
@Component({
  selector: 'app-organization-social-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, Input],
  template: `
    <ng-container *transloco="let t; read: 'admin.organizacion.redes'">
      <fieldset class="redes">
        <legend>{{ t('titulo') }}</legend>
        <p class="ayuda">{{ t('ayuda') }}</p>
        <div class="rejilla">
          @for (red of redes; track red) {
            <app-input
              [fieldId]="'red-' + red"
              type="url"
              [label]="nombre(red)"
              [value]="url(red)"
              (valueChange)="cambiar(red, $event)"
            />
          }
        </div>
        <div class="libre">
          <app-input
            fieldId="red-libre-nombre"
            [label]="t('libreNombre')"
            [hint]="t('libreNombreAyuda')"
            [value]="otraEtiqueta()"
            (valueChange)="cambiarOtra($event, otraUrl())"
          />
          <app-input
            fieldId="red-libre-url"
            type="url"
            [label]="t('libreUrl')"
            [value]="otraUrl()"
            (valueChange)="cambiarOtra(otraEtiqueta(), $event)"
          />
        </div>
      </fieldset>
    </ng-container>
  `,
  styles: `
    .redes {
      display: grid;
      gap: var(--space-md);
      margin: 0;
      padding: var(--space-md);
      border: 1px solid var(--line);
      border-radius: var(--radius-md, 8px);
    }
    legend {
      padding: 0 var(--space-sm, 8px);
      font-weight: 600;
    }
    .ayuda {
      margin: 0;
      font-size: var(--fs-sm);
      color: var(--muted);
    }
    .rejilla,
    .libre {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
      gap: var(--space-md);
    }
  `,
})
export class OrganizationSocialLinks {
  readonly enlaces = model<readonly EnlaceSocial[]>([]);

  protected readonly redes = REDES;
  protected readonly otra = computed(() => this.enlaces().find((e) => e.kind === 'other'));
  protected readonly otraEtiqueta = computed(() => this.otra()?.label ?? '');
  protected readonly otraUrl = computed(() => this.otra()?.url ?? '');

  protected nombre(red: Red): string {
    return NOMBRES[red];
  }

  protected url(red: Red): string {
    return this.enlaces().find((enlace) => enlace.kind === red)?.url ?? '';
  }

  protected cambiar(red: Red, url: string): void {
    const resto = this.enlaces().filter((enlace) => enlace.kind !== red);
    const limpia = url.trim();
    this.enlaces.set(limpia ? [...resto, { kind: red, url: limpia }] : resto);
  }

  protected cambiarOtra(etiqueta: string, url: string): void {
    const resto = this.enlaces().filter((enlace) => enlace.kind !== 'other');
    this.enlaces.set(
      etiqueta.trim() || url.trim()
        ? [...resto, { kind: 'other', url: url.trim(), label: etiqueta.trim() }]
        : resto,
    );
  }
}
