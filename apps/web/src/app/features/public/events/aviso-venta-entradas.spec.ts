import { describe, expect, it } from 'vitest';

import { avisoDeVenta } from './aviso-venta-entradas';

const AHORA = Date.parse('2026-10-21T17:00:00Z');
const dePago = {
  registration_mode: 'paid' as const,
  timezone: 'Europe/Madrid',
  ticket_sales: 'upcoming' as const,
  ticket_sales_opens_at: '2026-10-21T18:00:00Z',
};

describe('avisoDeVenta', () => {
  it('sin aviso en un evento gratuito o con entradas a la venta', () => {
    expect(avisoDeVenta({ ...dePago, registration_mode: 'free' }, 0, false, AHORA)).toBeNull();
    expect(avisoDeVenta(dePago, 2, false, AHORA)).toBeNull();
  });

  it('anuncia la apertura en la hora del evento, no la del navegador', () => {
    const aviso = avisoDeVenta(dePago, 0, false, AHORA);
    expect(aviso?.motivo).toBe('abre');
    // 18:00 UTC en octubre (horario de verano) son las 20:00 en Madrid.
    expect(aviso?.fecha).toContain('20:00');
  });

  it('venta cerrada', () => {
    const cerrada = { ...dePago, ticket_sales: 'closed' as const, ticket_sales_opens_at: null };
    expect(avisoDeVenta(cerrada, 0, false, AHORA)?.motivo).toBe('cerrada');
  });

  it('si la apertura pasó con la página abierta, la ficha deja inscribirse y el formulario pide recargar', () => {
    const despues = Date.parse('2026-10-21T18:30:00Z');
    expect(avisoDeVenta(dePago, null, false, despues)).toBeNull();
    expect(avisoDeVenta(dePago, 0, false, despues)?.motivo).toBe('recargar');
  });

  it('un fallo al cargar las entradas es un error, nunca «no hay entradas»', () => {
    expect(avisoDeVenta({ ...dePago, ticket_sales: 'open' }, 0, true, AHORA)?.motivo).toBe('error');
  });
});
