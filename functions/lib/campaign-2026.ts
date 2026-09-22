import { limpiarRut } from './rut.ts';

export const CAMPAIGN_ID = 'FIREHOUSE_2026';
export const CAMPAIGN_BASES_VERSION = '2026-1.0';
export const CAMPAIGN_PRIVACY_VERSION = '2026-1.0';
export const MAX_PARTICIPACIONES = 3;

export function enmascararRut(rut: string): string {
  const limpio = limpiarRut(rut);
  const cuerpo = limpio.slice(0, -1);
  return `${cuerpo.slice(0, 2)}.***.***-${limpio.slice(-1)}`;
}

export async function identityHash(rut: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(limpiarRut(rut)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

