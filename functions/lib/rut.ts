// Validación de RUT chileno (módulo 11). Nunca hay que confiar en la
// validación del navegador — esto es lo que corre server-side antes de
// guardar cualquier RUT.

/** Deja sólo dígitos + K/k, sin puntos ni guión, en mayúscula. */
export function limpiarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

function calcularDv(cuerpo: string): string {
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/** true si el RUT (con o sin puntos/guión) es formalmente válido. */
export function rutValido(rutCrudo: string): boolean {
  const limpio = limpiarRut(rutCrudo);
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return calcularDv(cuerpo) === dv;
}

/** Formatea a "12.345.678-9" para guardar/mostrar de forma consistente. */
export function formatearRut(rutCrudo: string): string {
  const limpio = limpiarRut(rutCrudo);
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpoConPuntos}-${dv}`;
}
