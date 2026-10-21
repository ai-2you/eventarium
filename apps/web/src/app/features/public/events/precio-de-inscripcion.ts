import type { PublicTicketType } from '../../../core/payments/public-checkout.service';

export function precioEnEuros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** `.summary__row` "Precio" (`inscripcion.html:178`): el más barato de los
 * tipos de entrada vendibles, con «Desde» si hay más de uno. Sin tipos, un
 * evento gratuito dice «Gratis»; uno de pago, una raya, porque su venta abre
 * más tarde o ya terminó (lo explica el aviso de venta). */
export function precioDelResumen(
  tipos: readonly PublicTicketType[],
  esDePago: boolean,
  traducir: (clave: string) => string,
): string {
  if (tipos.length === 0) {
    return esDePago ? '—' : traducir('inscripcion.resumen.gratis');
  }
  const masBarato = tipos.reduce((min, tipo) => (tipo.price_cents < min.price_cents ? tipo : min));
  const precio = `${precioEnEuros(masBarato.price_cents)} ${masBarato.currency.toUpperCase()}`;
  return tipos.length > 1 ? `${traducir('inscripcion.resumen.desde')} ${precio}` : precio;
}
