// Envío de un correo con plantilla a todo un grupo (una fecha de clase).
// Lógica pura: a quién se puede enviar, a quién se marca por defecto y el
// resumen que llega como copia a quien envía.

export interface Candidato {
  casoId: string;
  nombreAtleta: string;
  nombreApoderado: string;
  email: string | null;
  /** Fecha ISO del envío anterior de esta misma plantilla por correo, si existe. */
  yaEnviado: string | null;
  /** Motivo por el que esta plantilla no corresponde (ej.: ya pagó la inscripción). */
  bloqueo: string | null;
  /** Datos que faltan para completar la plantilla (texto para mostrar). */
  faltantes: string | null;
}

export interface EstadoCandidato {
  enviable: boolean;
  seleccionado: boolean;
  nota: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function estadoCandidato(c: Candidato, fechaCorta: (iso: string) => string = (iso) => iso.slice(0, 10)): EstadoCandidato {
  if (!c.email || !EMAIL_RE.test(c.email.trim())) return { enviable: false, seleccionado: false, nota: 'Sin correo registrado' };
  if (c.bloqueo) return { enviable: false, seleccionado: false, nota: c.bloqueo };
  if (c.faltantes) return { enviable: false, seleccionado: false, nota: c.faltantes };
  if (c.yaEnviado) return { enviable: true, seleccionado: false, nota: `Ya se le envió este correo el ${fechaCorta(c.yaEnviado)}` };
  return { enviable: true, seleccionado: true, nota: null };
}

/** Avisa cuando dos deportistas del grupo comparten el correo del apoderado (hermanas). */
export function correosCompartidos(candidatos: Candidato[]): Map<string, string> {
  const primero = new Map<string, Candidato>();
  const notas = new Map<string, string>();
  for (const c of candidatos) {
    const clave = c.email?.trim().toLowerCase();
    if (!clave) continue;
    const previo = primero.get(clave);
    if (previo) {
      notas.set(c.casoId, `Mismo correo que ${previo.nombreAtleta}: recibirá un correo por cada una`);
    } else {
      primero.set(clave, c);
    }
  }
  return notas;
}

export interface ResultadoEnvio {
  nombreAtleta: string;
  nombreApoderado: string;
  email: string;
  ok: boolean;
  error?: string;
}

/** Líneas del resumen para la copia interna. */
export function lineasResumen(resultados: ResultadoEnvio[], omitidos: Array<{ nombreAtleta: string; motivo: string }>): string[] {
  const enviados = resultados.filter((r) => r.ok);
  const fallidos = resultados.filter((r) => !r.ok);
  const lineas = [`Enviado a ${enviados.length} ${enviados.length === 1 ? 'familia' : 'familias'}:`];
  enviados.forEach((r) => lineas.push(`✓ ${r.nombreAtleta} · ${r.nombreApoderado} (${r.email})`));
  if (fallidos.length) {
    lineas.push(`No se pudo enviar a ${fallidos.length}:`);
    fallidos.forEach((r) => lineas.push(`✗ ${r.nombreAtleta} · ${r.nombreApoderado}: ${r.error ?? 'error'}`));
  }
  if (omitidos.length) {
    lineas.push(`No incluidos (${omitidos.length}):`);
    omitidos.forEach((o) => lineas.push(`– ${o.nombreAtleta}: ${o.motivo}`));
  }
  return lineas;
}

/** Pausa entre correos: Resend acepta hasta 2 por segundo en su plan base. */
export const PAUSA_ENTRE_CORREOS_MS = 700;
