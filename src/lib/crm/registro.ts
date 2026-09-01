// Orquesta la validación completa de un envío del formulario público /registro.
// Es la única puerta de entrada que debe usar el endpoint server-side antes de tocar la base de datos.

import { LIMITES, INTERES_OPCIONES, COMO_CONOCIO_OPCIONES, CANAL_PREFERIDO, RELACION_APODERADO, INTENCION_INICIAL, PRIVACY_POLICY_VERSION } from './constants.ts';
import { clasificarJourney } from './journey.ts';
import { esDiaClasePruebaValido, diaEstaHabilitado, type DiaClasePrueba, type DiasHabilitados } from './clase-prueba.ts';
import {
  validarNombre,
  validarEmail,
  validarTelefono,
  validarComuna,
  validarComentario,
  calcularEdad,
  limpiarTexto,
} from './validation.ts';
import type { ValidationError, Journey, IntencionInicial } from './types.ts';

export interface AtletaValidado {
  nombre: string;
  apellidos: string;
  fechaNacimiento: string;
  edad: number;
  fueraRangoHabitual: boolean;
  firehouseActual: boolean;
  intencionInicial: IntencionInicial | null;
  tieneExperiencia: boolean | null;
  aniosExperiencia: string | null;
  academiaAnterior: string | null;
  journey: Journey;
  diaClasePrueba: DiaClasePrueba | null;
}

export interface RegistroValidado {
  submissionId: string;
  apoderado: {
    nombre: string;
    apellidos: string;
    telefono: string;
    telefonoSecundario: string | null;
    email: string;
    relacion: string;
    comuna: string;
    comoConocio: string;
    canalPreferido: string;
    comentarioInicial: string | null;
    consentContact: true;
    privacyPolicyVersion: string;
  };
  atletas: AtletaValidado[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esUUID(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

function valorEnConjunto(valor: unknown, conjunto: Record<string, string>): boolean {
  return typeof valor === 'string' && Object.values(conjunto).includes(valor);
}

export function validarRegistroPublico(
  payload: any,
  diasHabilitados: DiasHabilitados = { viernes: false, sabado: false },
): { ok: true; value: RegistroValidado } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: [{ field: 'root', message: 'Solicitud inválida.' }] };
  }

  // Honeypot: si viene con contenido, es un bot. No damos pistas, sólo rechazamos "silenciosamente"
  // desde el caller (no se trata como error de validación normal).
  if (limpiarTexto(payload.honeypot) !== '') {
    errors.push({ field: 'honeypot', message: 'Solicitud rechazada.' });
  }

  if (!esUUID(payload.submissionId)) {
    errors.push({ field: 'submissionId', message: 'Falta identificador de envío.' });
  }

  const ap = payload.apoderado ?? {};

  const errNombre = validarNombre(ap.nombre, 'apoderado.nombre');
  if (errNombre) errors.push(errNombre);

  const errApellidos = validarNombre(ap.apellidos, 'apoderado.apellidos', LIMITES.APELLIDOS_MAX);
  if (errApellidos) errors.push(errApellidos);

  const { telefono, error: errTelefono } = validarTelefono(ap.telefono, 'apoderado.telefono', true);
  if (errTelefono) errors.push(errTelefono);

  const { telefono: telefonoSecundario, error: errTelSec } = validarTelefono(
    ap.telefonoSecundario,
    'apoderado.telefonoSecundario',
    false,
  );
  if (errTelSec) errors.push(errTelSec);

  const { email, error: errEmail } = validarEmail(ap.email);
  if (errEmail) errors.push(errEmail);

  if (!valorEnConjunto(ap.relacion, RELACION_APODERADO)) {
    errors.push({ field: 'apoderado.relacion', message: 'Selecciona una relación válida.' });
  }

  const { comuna, error: errComuna } = validarComuna(ap.comuna);
  if (errComuna) errors.push(errComuna);

  if (!valorEnConjunto(ap.comoConocio, COMO_CONOCIO_OPCIONES)) {
    errors.push({ field: 'apoderado.comoConocio', message: 'Selecciona cómo conociste Firehouse.' });
  }

  if (!valorEnConjunto(ap.canalPreferido, CANAL_PREFERIDO)) {
    errors.push({ field: 'apoderado.canalPreferido', message: 'Selecciona un canal de contacto.' });
  }

  const { texto: comentarioInicial, error: errComentario } = validarComentario(
    ap.comentarioInicial,
    LIMITES.COMENTARIO_INICIAL_MAX,
    'apoderado.comentarioInicial',
  );
  if (errComentario) errors.push(errComentario);

  if (ap.consentContact !== true) {
    errors.push({ field: 'apoderado.consentContact', message: 'Debes autorizar el contacto para continuar.' });
  }

  const atletasRaw = Array.isArray(payload.atletas) ? payload.atletas : [];
  if (atletasRaw.length === 0) {
    errors.push({ field: 'atletas', message: 'Agrega al menos un/a atleta.' });
  }
  if (atletasRaw.length > LIMITES.MAX_ATLETAS_POR_REGISTRO) {
    errors.push({ field: 'atletas', message: `No se admiten más de ${LIMITES.MAX_ATLETAS_POR_REGISTRO} atletas por registro.` });
  }

  const atletas: AtletaValidado[] = [];

  atletasRaw.slice(0, LIMITES.MAX_ATLETAS_POR_REGISTRO).forEach((a: any, i: number) => {
    const prefijo = `atletas[${i}]`;

    const errNombreAtleta = validarNombre(a?.nombre, `${prefijo}.nombre`);
    if (errNombreAtleta) errors.push(errNombreAtleta);

    const errApellidosAtleta = validarNombre(a?.apellidos, `${prefijo}.apellidos`, LIMITES.APELLIDOS_MAX);
    if (errApellidosAtleta) errors.push(errApellidosAtleta);

    const edadInfo = calcularEdad(typeof a?.fechaNacimiento === 'string' ? a.fechaNacimiento : '');
    if (!edadInfo) {
      errors.push({ field: `${prefijo}.fechaNacimiento`, message: 'Fecha de nacimiento inválida.' });
    }

    const firehouseActual = a?.firehouseActual === true;

    let intencionInicial: IntencionInicial | null = null;
    let interes: string | null = null;
    let tieneExperiencia: boolean | null = null;
    let aniosExperiencia: string | null = null;
    let academiaAnterior: string | null = null;
    let diaClasePrueba: DiaClasePrueba | null = null;

    if (firehouseActual) {
      if (a?.intencionInicial === INTENCION_INICIAL.CONTINUAR || a?.intencionInicial === INTENCION_INICIAL.INDECISO) {
        intencionInicial = a.intencionInicial;
      } else {
        intencionInicial = INTENCION_INICIAL.INDECISO;
      }
    } else {
      if (!valorEnConjunto(a?.interes, INTERES_OPCIONES)) {
        errors.push({ field: `${prefijo}.interes`, message: 'Selecciona qué alternativa les interesa.' });
      } else {
        interes = a.interes;
        if (interes === INTERES_OPCIONES.CLASE_PRUEBA) {
          if (esDiaClasePruebaValido(a?.diaClasePrueba) && diaEstaHabilitado(a.diaClasePrueba, diasHabilitados)) {
            diaClasePrueba = a.diaClasePrueba;
          } else {
            errors.push({ field: `${prefijo}.diaClasePrueba`, message: 'Selecciona un día disponible (viernes o sábado).' });
          }
        }
      }

      if (typeof a?.tieneExperiencia === 'boolean') {
        tieneExperiencia = a.tieneExperiencia;
        if (a.tieneExperiencia) {
          if (typeof a?.aniosExperiencia === 'string' && a.aniosExperiencia) {
            aniosExperiencia = a.aniosExperiencia;
          }
          const { texto, error: errAcademia } = validarComentario(
            a?.academiaAnterior,
            LIMITES.ACADEMIA_ANTERIOR_MAX,
            `${prefijo}.academiaAnterior`,
          );
          if (errAcademia) errors.push(errAcademia);
          academiaAnterior = texto;
        }
      } else {
        tieneExperiencia = false;
      }
    }

    if (!edadInfo) return; // no seguimos calculando journey si la fecha es inválida

    const { journey } = clasificarJourney({
      firehouseActual,
      intencionInicial,
      interes: interes as any,
      tieneExperiencia,
    });

    atletas.push({
      nombre: limpiarTexto(a.nombre),
      apellidos: limpiarTexto(a.apellidos),
      fechaNacimiento: a.fechaNacimiento,
      edad: edadInfo.edad,
      fueraRangoHabitual: edadInfo.fueraRangoHabitual,
      firehouseActual,
      intencionInicial,
      tieneExperiencia,
      aniosExperiencia,
      academiaAnterior,
      journey,
      diaClasePrueba,
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      submissionId: payload.submissionId,
      apoderado: {
        nombre: limpiarTexto(ap.nombre),
        apellidos: limpiarTexto(ap.apellidos),
        telefono: telefono!,
        telefonoSecundario,
        email: email!,
        relacion: ap.relacion,
        comuna: comuna!,
        comoConocio: ap.comoConocio,
        canalPreferido: ap.canalPreferido,
        comentarioInicial,
        consentContact: true,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      },
      atletas,
    },
  };
}
