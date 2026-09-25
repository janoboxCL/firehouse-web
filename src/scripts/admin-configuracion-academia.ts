// Secciones "Firehouse Star: horario", "Cobros" y "Tallas de polera" de
// /admin/configuracion (tabla configuracion_academia, migración 0012).

import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarConfigAcademia, obtenerConfigAcademia } from '../lib/crm/admin-config-api.ts';
import { montosProrrateo, nombreDiaSemana, parsearTallas, validarConfig, type ConfigAcademia } from '../lib/crm/config-academia.ts';
import { getNextStarClassDate } from '../lib/crm/star-class.ts';
import { hoyChile } from '../lib/crm/programas.ts';

function $<T extends Element>(s: string): T {
  const el = document.querySelector<T>(s);
  if (!el) throw new Error(`Falta ${s}`);
  return el;
}

const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

let supabase: SupabaseClient;
let config: ConfigAcademia;
let mensualidadStar = 30000;

function avisar(clave: string, error: string | null): void {
  const ok = $<HTMLElement>(`[data-ok="${clave}"]`);
  const err = $<HTMLElement>(`[data-error="${clave}"]`);
  if (error) {
    err.textContent = error;
    err.hidden = false;
    ok.hidden = true;
  } else {
    err.hidden = true;
    ok.hidden = false;
    setTimeout(() => (ok.hidden = true), 2500);
  }
}

async function guardar(clave: string, cambios: Partial<ConfigAcademia>): Promise<void> {
  const nuevo = { ...config, ...cambios };
  const v = validarConfig(nuevo);
  if (!v.ok) {
    avisar(clave, v.error);
    return;
  }
  try {
    await guardarConfigAcademia(supabase, nuevo);
    config = nuevo;
    renderVistaStar();
    renderProrrateo();
    avisar(clave, null);
  } catch {
    avisar(clave, 'No se pudo guardar. Revisa tu conexión e inténtalo nuevamente.');
  }
}

function renderVistaStar(): void {
  const hoy = hoyChile();
  const proximas: string[] = [];
  let fecha = getNextStarClassDate(new Date(`${hoy}T12:00:00-03:00`), $<HTMLInputElement>('#st-primera').value || config.starPrimeraClase);
  for (let i = 0; i < 3; i++) {
    proximas.push(fechaCorta(fecha));
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    fecha = d.toISOString().slice(0, 10);
  }
  const primera = $<HTMLInputElement>('#st-primera').value || config.starPrimeraClase;
  $<HTMLElement>('#st-vista').textContent =
    `Clases los ${nombreDiaSemana(primera)} de ${$<HTMLInputElement>('#st-inicio').value} a ${$<HTMLInputElement>('#st-fin').value}. Próximas: ${proximas.join(', ')}.`;
}

function renderProrrateo(): void {
  const etiquetas = ['Semana 1 (días 1 a 7)', 'Semana 2 (días 8 a 14)', 'Semana 3 (días 15 a 21)', 'Semana 4 o después'];
  const montos = montosProrrateo(mensualidadStar, config.prorrateo);
  $<HTMLElement>('#cb-prorrateo').innerHTML = config.prorrateo
    .map(
      (p, i) => `<tr><td>${etiquetas[i]}</td>
        <td><input class="admin-input cb-pct" type="number" min="0" max="100" step="1" data-semana="${i}" value="${p}" aria-label="Porcentaje ${etiquetas[i]}" /></td>
        <td data-ejemplo="${i}">${pesos(montos[i])}</td></tr>`,
    )
    .join('');
}

export async function iniciarConfiguracionAcademia(cliente: SupabaseClient): Promise<void> {
  supabase = cliente;
  const { config: c, disponible } = await obtenerConfigAcademia(supabase).catch(() => ({ config: null, disponible: false }));
  if (!disponible || !c) {
    const aviso = $<HTMLElement>('#ac-aviso');
    aviso.textContent = 'El horario de Star, los cobros y las tallas se podrán editar después de ejecutar la migración 0012 en Supabase.';
    aviso.hidden = false;
    return;
  }
  config = c;
  const { data: precio } = await supabase
    .from('programa_precios')
    .select('mensualidad')
    .eq('programa_codigo', 'STAR')
    .eq('temporada', Number(hoyChile().slice(0, 4)))
    .maybeSingle();
  if (precio?.mensualidad) mensualidadStar = precio.mensualidad as number;

  $<HTMLInputElement>('#st-primera').value = config.starPrimeraClase;
  $<HTMLInputElement>('#st-inicio').value = config.starHoraInicio;
  $<HTMLInputElement>('#st-fin').value = config.starHoraFin;
  $<HTMLInputElement>('#cb-vencimiento').value = String(config.diaVencimiento);
  $<HTMLInputElement>('#tl-lista').value = config.tallas.join(', ');
  renderVistaStar();
  renderProrrateo();

  ['#st-primera', '#st-inicio', '#st-fin'].forEach((s) => $<HTMLInputElement>(s).addEventListener('input', renderVistaStar));
  $<HTMLElement>('#cb-prorrateo').addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const i = Number(input.dataset.semana);
    const monto = Math.round((mensualidadStar * Number(input.value || 0)) / 100);
    $<HTMLElement>(`[data-ejemplo="${i}"]`).textContent = pesos(monto);
  });

  $<HTMLFormElement>('#st-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const primera = $<HTMLInputElement>('#st-primera').value;
    if (primera !== config.starPrimeraClase && !confirm('Cambiar la primera clase afecta la fecha que se asigna a las nuevas clases de prueba Star. Las ya agendadas no cambian. ¿Continuar?')) return;
    void guardar('st', {
      starPrimeraClase: primera,
      starHoraInicio: $<HTMLInputElement>('#st-inicio').value,
      starHoraFin: $<HTMLInputElement>('#st-fin').value,
    });
  });
  $<HTMLFormElement>('#cb-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const prorrateo = [...document.querySelectorAll<HTMLInputElement>('#cb-prorrateo [data-semana]')].map((i) => Number(i.value));
    void guardar('cb', { diaVencimiento: Number($<HTMLInputElement>('#cb-vencimiento').value), prorrateo });
  });
  $<HTMLFormElement>('#tl-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const tallas = parsearTallas($<HTMLInputElement>('#tl-lista').value);
    $<HTMLInputElement>('#tl-lista').value = tallas.join(', ');
    void guardar('tl', { tallas });
  });

  for (const id of ['#st-seccion', '#cb-seccion', '#tl-seccion']) $<HTMLElement>(id).hidden = false;
}
