// Asistencia por fecha de clase (migración 0016). Lógica pura, sin DOM.
//
// En pantalla se marca y desmarca libremente; nada se guarda hasta "Grabar
// asistencia". Por cada fecha se conservan dos conjuntos de deportistas
// (atleta_id): lo que está grabado en la base y lo que está marcado ahora.

export interface AsistenciaFecha {
  /** Deportistas con asistencia grabada en la base. */
  guardadas: Set<string>;
  /** Deportistas marcados en pantalla. */
  marcadas: Set<string>;
}

export interface CambiosFecha {
  /** Marcados que no estaban grabados: se agregan. */
  presentes: string[];
  /** Grabados que se desmarcaron: se borran. */
  ausentes: string[];
}

export function nuevaAsistencia(guardadas: Iterable<string>): AsistenciaFecha {
  return { guardadas: new Set(guardadas), marcadas: new Set(guardadas) };
}

export function cambiosDeFecha(a: AsistenciaFecha): CambiosFecha {
  return {
    presentes: [...a.marcadas].filter((id) => !a.guardadas.has(id)),
    ausentes: [...a.guardadas].filter((id) => !a.marcadas.has(id)),
  };
}

export function cantidadCambios(a: AsistenciaFecha): number {
  const c = cambiosDeFecha(a);
  return c.presentes.length + c.ausentes.length;
}

export function totalCambios(porFecha: Map<string, AsistenciaFecha>): number {
  let total = 0;
  porFecha.forEach((a) => (total += cantidadCambios(a)));
  return total;
}

/** Marca o desmarca un deportista en pantalla (no graba). */
export function alternar(a: AsistenciaFecha, atletaId: string, presente: boolean): void {
  if (presente) a.marcadas.add(atletaId);
  else a.marcadas.delete(atletaId);
}

/** Después de grabar con éxito, lo marcado pasa a ser lo grabado. */
export function confirmarGrabado(a: AsistenciaFecha): void {
  a.guardadas = new Set(a.marcadas);
}

/**
 * Al recargar el listado: si la fecha tenía cambios sin grabar se conservan
 * las marcas en pantalla; si no, se toma lo grabado en la base.
 */
export function combinarAlRecargar(previa: AsistenciaFecha | undefined, guardadasBase: Iterable<string>): AsistenciaFecha {
  const guardadas = new Set(guardadasBase);
  if (previa && cantidadCambios(previa) > 0) return { guardadas, marcadas: new Set(previa.marcadas) };
  return { guardadas, marcadas: new Set(guardadas) };
}

export function textoCambios(n: number): string {
  return `${n} ${n === 1 ? 'cambio' : 'cambios'}`;
}

export function textoPresentes(presentes: number, total: number): string {
  return `${presentes} de ${total} ${total === 1 ? 'presente' : 'presentes'}`;
}

/** Porcentaje para la barra de progreso (0 a 100, sin decimales). */
export function porcentaje(presentes: number, total: number): number {
  return total > 0 ? Math.round((presentes / total) * 100) : 0;
}
