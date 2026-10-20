import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemberProfileForm } from './member-profile-form';
import { ProfileField } from '../../../shared/ui/dynamic-field.model';
import { esperarSinViolacionesDeAccesibilidad } from '../../../../testing/axe';
import es from '../../../../../public/assets/i18n/es-ES.json';

const CAMPOS: ProfileField[] = [
  { key: 'bio', label: 'Biografía', field_type: 'textarea', options: null, is_required: true },
];
const URL_FICHA = '/api/v1/organizations/me/members/m1/profile';

async function avanzar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('MemberProfileForm', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { 'es-ES': es },
          translocoConfig: { availableLangs: ['es-ES'], defaultLang: 'es-ES' },
        }),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function crear(campos: ProfileField[], datos: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(MemberProfileForm);
    fixture.componentRef.setInput('organizationMemberId', 'm1');
    fixture.componentRef.setInput('campos', campos);
    fixture.componentRef.setInput('datos', datos);
    fixture.componentRef.setInput('updatedAt', '2026-10-19T10:00:00Z');
    return fixture;
  }

  function enviar(fixture: ComponentFixture<MemberProfileForm>): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
  }

  it('sin campos en el rol lo dice y no ofrece formulario', async () => {
    const fixture = crear([]);
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).toContain('Tu rol no tiene ficha que completar');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('una biografía demasiado larga se corrige antes de enviar', async () => {
    const fixture = crear(CAMPOS, { bio: 'a'.repeat(5001) });
    await avanzar(fixture);
    enviar(fixture);
    await avanzar(fixture);

    http.expectNone(URL_FICHA);
    expect(fixture.nativeElement.textContent).toContain('ahora tiene 5001');
  });

  it('envía solo las claves del rol con la versión leída, y la siguiente usa la nueva', async () => {
    const fixture = crear(CAMPOS, { bio: 'Hola', twitter: '@antiguo' });
    await avanzar(fixture);
    expect((fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Hola',
    );

    enviar(fixture);
    const primera = http.expectOne(URL_FICHA);
    expect(primera.request.method).toBe('PATCH');
    expect(primera.request.body).toEqual({
      profile_data: { bio: 'Hola' },
      expected_updated_at: '2026-10-19T10:00:00Z',
    });
    primera.flush({ profile_data: { bio: 'Hola' }, updated_at: '2026-10-19T11:00:00Z' });
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).toContain('Ficha guardada');
    await esperarSinViolacionesDeAccesibilidad(fixture.nativeElement);

    enviar(fixture);
    const segunda = http.expectOne(URL_FICHA);
    expect(segunda.request.body.expected_updated_at).toBe('2026-10-19T11:00:00Z');
    segunda.flush(
      { detail: 'La ficha ha cambiado mientras la editabas.' },
      { status: 409, statusText: 'Conflict' },
    );
    await avanzar(fixture);
    expect(fixture.nativeElement.textContent).not.toContain('Ficha guardada');
  });
});
