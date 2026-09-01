// Clasificación automática del journey de un atleta.
// Esta lógica es la fuente de verdad y corre exclusivamente server-side
// (endpoint /api/registro y, como respaldo, la función RPC en Postgres).
// El navegador puede replicarla sólo para mostrar contenido dinámico, nunca como fuente de verdad.

import { CRM_JOURNEYS, INTENCION_INICIAL, INTERES_OPCIONES } from './constants.ts';
import type { ClasificacionJourney, Interest, IntencionInicial } from './types.ts';

export interface DatosClasificacion {
  firehouseActual: boolean;
  /** Sólo aplica cuando firehouseActual = true. */
  intencionInicial?: IntencionInicial | null;
  /** Sólo aplica cuando firehouseActual = false. */
  interes?: Interest | null;
  tieneExperiencia?: boolean | null;
}

/**
 * SI firehouse_actual = true              → RENOVACION_2027
 * SI interes = PRETEMPORADA               → PRETEMPORADA
 * SI interes = TEMPORADA_2027 + experiencia    → EXPERIMENTADA_2027
 * SI interes = TEMPORADA_2027 + sin experiencia → PRINCIPIANTE_2027
 * SI interes = CLASE_PRUEBA               → CLASE_PRUEBA
 * SI interes = NO_SEGURO                  → POR_CLASIFICAR
 */
export function clasificarJourney(datos: DatosClasificacion): ClasificacionJourney {
  if (datos.firehouseActual) {
    const intencion = datos.intencionInicial ?? INTENCION_INICIAL.INDECISO;
    return { journey: CRM_JOURNEYS.RENOVACION_2027, intencionInicial: intencion };
  }

  switch (datos.interes) {
    case INTERES_OPCIONES.PRETEMPORADA:
      return { journey: CRM_JOURNEYS.PRETEMPORADA, intencionInicial: null };
    case INTERES_OPCIONES.TEMPORADA_2027:
      return {
        journey: datos.tieneExperiencia
          ? CRM_JOURNEYS.EXPERIMENTADA_2027
          : CRM_JOURNEYS.PRINCIPIANTE_2027,
        intencionInicial: null,
      };
    case INTERES_OPCIONES.CLASE_PRUEBA:
      return { journey: CRM_JOURNEYS.CLASE_PRUEBA, intencionInicial: null };
    case INTERES_OPCIONES.NO_SEGURO:
    default:
      return { journey: CRM_JOURNEYS.POR_CLASIFICAR, intencionInicial: null };
  }
}
