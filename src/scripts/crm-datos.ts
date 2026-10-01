// Carga común de Deportistas, Asistencia y Estadísticas: casos, asistencias
// grabadas (migración 0016) y configuración de la academia.

import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerCasos, type CasoResumen } from '../lib/crm/admin-api.ts';
import { obtenerTodasAsistencias } from '../lib/crm/admin-asistencia-api.ts';
import { obtenerConfigAcademia } from '../lib/crm/admin-config-api.ts';
import { CONFIG_RESPALDO, type ConfigAcademia } from '../lib/crm/config-academia.ts';
import { construirFilas, type FilaDeportista, type RegistroAsistencia } from '../lib/crm/deportistas.ts';
import { hoyChile } from '../lib/crm/programas.ts';

export interface DatosCrm {
  casos: CasoResumen[];
  asistencias: RegistroAsistencia[];
  /** false si la migración 0016 aún no está aplicada. */
  asistenciaDisponible: boolean;
  config: ConfigAcademia;
  hoy: string;
  filas: FilaDeportista[];
}

export async function cargarDatosCrm(supabase: SupabaseClient): Promise<DatosCrm> {
  const [casos, asis, cfg] = await Promise.all([
    obtenerCasos(supabase),
    obtenerTodasAsistencias(supabase),
    obtenerConfigAcademia(supabase).catch(() => null),
  ]);
  const config = cfg?.config ?? CONFIG_RESPALDO;
  const hoy = hoyChile();
  return {
    casos,
    asistencias: asis.registros,
    asistenciaDisponible: asis.disponible,
    config,
    hoy,
    filas: construirFilas(casos, asis.registros, { hoy, primeraClaseStar: config.starPrimeraClase }),
  };
}

export function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

/** Descarga un CSV que Excel abre con tildes (BOM y separador ;). */
export function descargarCsv(nombre: string, filas: Array<Array<string | number>>): void {
  const celda = (v: string | number) => {
    const t = String(v ?? '');
    return /[;"\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  const texto = '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
