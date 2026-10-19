import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';

/** Utilidades puras de `DatetimePicker`, fuera del componente para que este
 * no crezca: conversión del valor `YYYY-MM-DDTHH:mm`, lectura de lo tecleado
 * en la caja de hora y textos reactivos. */

/** Lo que muestra el campo de hora mientras no hay valor. */
export const HORA_VACIA = '--:--';

/** Una celda del calendario: la fecha real y los estados que la pintan. */
export interface CeldaDia {
  readonly fecha: Date;
  readonly fueraDeMes: boolean;
  readonly esHoy: boolean;
  readonly esSeleccionado: boolean;
  readonly etiqueta: string;
}

export interface PartesValor {
  readonly anio: number;
  readonly mes: number;
  readonly dia: number;
  readonly hora: number;
  readonly minuto: number;
}

export function dosCifras(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DDTHH:mm`, el formato de `<input type="datetime-local">` que este
 * componente usa como valor de verdad. */
export function aValorLocal(partes: {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}): string {
  return (
    `${partes.anio}-${dosCifras(partes.mes + 1)}-${dosCifras(partes.dia)}` +
    `T${dosCifras(partes.hora)}:${dosCifras(partes.minuto)}`
  );
}

export function partirValor(valor: string): PartesValor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(valor);
  if (!m) return null;
  return {
    anio: Number(m[1]),
    mes: Number(m[2]) - 1,
    dia: Number(m[3]),
    hora: Number(m[4]),
    minuto: Number(m[5]),
  };
}

/** `YYYY-MM-DD`, el formato de `<input type="date">` (modo `soloFecha`). */
export function aValorFecha(dia: { anio: number; mes: number; dia: number }): string {
  return `${dia.anio}-${dosCifras(dia.mes + 1)}-${dosCifras(dia.dia)}`;
}

/** Lee un `YYYY-MM-DD` (modo `soloFecha`); la hora queda a medianoche. */
export function partirFecha(valor: string): PartesValor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  return { anio: Number(m[1]), mes: Number(m[2]) - 1, dia: Number(m[3]), hora: 0, minuto: 0 };
}

export function hoy(): PartesValor {
  const ahora = new Date();
  return {
    anio: ahora.getFullYear(),
    mes: ahora.getMonth(),
    dia: ahora.getDate(),
    hora: ahora.getHours(),
    minuto: ahora.getMinutes(),
  };
}

/** Entiende lo que cabe esperar que teclee una persona en la caja de hora:
 * «9» (09:00), «935» (09:35), «9:35» o «09:35». Devuelve null mientras lo
 * tecleado todavía no forma una hora válida. */
export function parseHoraTexto(texto: string): { hora: number; minuto: number } | null {
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length === 0 || digitos.length > 4) return null;
  const hora = digitos.length <= 2 ? Number(digitos) : Number(digitos.slice(0, digitos.length - 2));
  const minuto = digitos.length <= 2 ? 0 : Number(digitos.slice(-2));
  if (Number.isNaN(hora) || Number.isNaN(minuto)) return null;
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto };
}

/** Texto reactivo de Transloco: `translate()` a secas no es reactivo y, si la
 * primera pintura ocurre antes de que el idioma esté cargado, dejaría la clave
 * cruda congelada en la plantilla. `selectTranslate` emite cuando la
 * traducción está lista y `toSignal` obliga a repintar. */
export function texto(transloco: TranslocoService, clave: string) {
  return toSignal(transloco.selectTranslate(clave).pipe(takeUntilDestroyed()), {
    initialValue: '',
  });
}

export function primerDiaDeMes(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}
