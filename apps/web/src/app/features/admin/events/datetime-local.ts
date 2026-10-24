/**
 * Convierte un ISO en UTC (lo que devuelve la API) al valor que espera un
 * `<input type="datetime-local">`: hora **local** del navegador, sin sufijo de
 * zona. Usar `.slice(0, 16)` directamente sobre el ISO dejaría el campo en
 * UTC en vez de en la hora local, desincronizado del valor que se envió al
 * guardar (que sí se convierte de local a UTC).
 */
export function isoAValorLocal(iso: string, { redondearArriba = false } = {}): string {
  const fecha = new Date(iso);
  // El campo no tiene segundos: un límite inferior a las 09:00:30 debe dejar
  // elegir 09:01, no 09:00 (que el backend rechazaría por quedar antes).
  if (redondearArriba && fecha.getTime() % 60_000 !== 0) {
    fecha.setTime(Math.ceil(fecha.getTime() / 60_000) * 60_000);
  }
  const desplazamiento = fecha.getTimezoneOffset() * 60_000;
  return new Date(fecha.getTime() - desplazamiento).toISOString().slice(0, 16);
}
