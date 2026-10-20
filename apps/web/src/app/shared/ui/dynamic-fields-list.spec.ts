import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';

import es from '../../../../public/assets/i18n/es-ES.json';

import { ProfileField } from './dynamic-field.model';
import {
  DynamicFieldsList,
  type ErroresDePerfil,
  type ValoresDePerfil,
} from './dynamic-fields-list';

const CAMPOS: ProfileField[] = [
  { key: 'bio', label: 'Biografía', field_type: 'textarea', options: null, is_required: true },
  { key: 'empresa', label: 'Empresa', field_type: 'text', options: null, is_required: false },
];

@Component({
  imports: [DynamicFieldsList],
  template: `<app-dynamic-fields-list
    prefijo="p"
    [campos]="campos"
    [(valores)]="valores"
    [(errores)]="errores"
  />`,
})
class Anfitrion {
  readonly campos = CAMPOS;
  readonly valores = signal<ValoresDePerfil>({ empresa: 'Acme' });
  readonly errores = signal<ErroresDePerfil>({});
}

describe('DynamicFieldsList', () => {
  it('pinta un control por campo, reúne valores y valida al salir', async () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const raiz = fixture.nativeElement as HTMLElement;

    expect((raiz.querySelector('#p-empresa') as HTMLInputElement).value).toBe('Acme');
    const bio = raiz.querySelector('#p-bio') as HTMLTextAreaElement;
    bio.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(fixture.componentInstance.errores()['bio']).toContain('obligatorio');

    bio.value = 'Hola';
    bio.dispatchEvent(new Event('input'));
    bio.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(fixture.componentInstance.valores()).toEqual({ empresa: 'Acme', bio: 'Hola' });
    expect(fixture.componentInstance.errores()['bio']).toBeNull();
  });
});
