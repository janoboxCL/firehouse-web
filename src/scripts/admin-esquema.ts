import { requireAdminSession, montarCabeceraAdmin } from '../lib/crm/auth.ts';
import type { FuncionRpc, TablaEsquema } from '../lib/crm/esquema.ts';

interface RespuestaEsquema {
  generado_at: string;
  fuente_tablas: string;
  openapi_disponible: boolean;
  advertencias: string[];
  migraciones: Array<{ version: string; descripcion: string; aplicada_at: string; retroactiva: boolean }> | null;
  tablas: TablaEsquema[];
  funciones_rpc: FuncionRpc[];
  resumenes: Array<{ tabla: string; columnas: string[]; grupos: Array<{ valores: Record<string, string>; total: number }> }>;
  avanzado: null | {
    funciones: Array<{ nombre: string; argumentos: string; security_definer: boolean }>;
    politicas: unknown[];
    restricciones: unknown[];
    triggers: unknown[];
    version_postgres: string | null;
  };
}

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatoFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

let ultimo: RespuestaEsquema | null = null;

function render(d: RespuestaEsquema): void {
  $<HTMLElement>('#esq-advertencias')!.innerHTML = d.advertencias
    .map((a) => `<div class="admin-aviso-cerrado">${esc(a)}</div>`)
    .join('');

  const totalFunciones = d.avanzado ? d.avanzado.funciones.length : d.funciones_rpc.length;
  $<HTMLElement>('#esq-resumen')!.innerHTML = `
    <div><dt>Tablas</dt><dd>${d.tablas.length}</dd></div>
    <div><dt>Funciones</dt><dd>${totalFunciones}</dd></div>
    <div><dt>Migraciones</dt><dd>${d.migraciones ? d.migraciones.length : 'sin registro'}</dd></div>
    <div><dt>Detalle avanzado</dt><dd class="esq-resumen__texto">${d.avanzado ? 'Disponible' : 'No disponible'}</dd></div>
    <div><dt>Generado</dt><dd class="esq-resumen__texto">${esc(formatoFecha(d.generado_at))}</dd></div>`;

  $<HTMLElement>('#esq-migraciones')!.innerHTML = d.migraciones
    ? `<table class="esq-tabla"><thead><tr><th>Versión</th><th>Descripción</th><th>Registrada</th></tr></thead><tbody>${d.migraciones
        .map(
          (m) =>
            `<tr><td>${esc(m.version)}</td><td>${esc(m.descripcion)}</td><td>${
              m.retroactiva ? '<span class="admin-badge admin-badge--estado-cerrado-no">Retroactiva</span>' : esc(formatoFecha(m.aplicada_at))
            }</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="admin-vacio">Aún no existe el registro de migraciones. Se crea con la migración 0006.</p>';

  $<HTMLElement>('#esq-resumenes')!.innerHTML = d.resumenes.length
    ? d.resumenes
        .map(
          (r) => `
      <h3 class="ficha-bloque__subtitulo">${esc(r.tabla)} por ${esc(r.columnas.join(' y '))}</h3>
      <div class="esq-scroll"><table class="esq-tabla"><thead><tr>${r.columnas.map((c) => `<th>${esc(c)}</th>`).join('')}<th class="esq-num">Registros</th></tr></thead>
      <tbody>${r.grupos
        .map((g) => `<tr>${r.columnas.map((c) => `<td>${esc(g.valores[c])}</td>`).join('')}<td class="esq-num">${g.total}</td></tr>`)
        .join('')}</tbody></table></div>`,
        )
        .join('')
    : '<p class="admin-vacio">No hay distribuciones disponibles.</p>';

  $<HTMLElement>('#esq-tablas')!.innerHTML = d.tablas
    .map(
      (t) => `
    <details class="esq-detalle">
      <summary><span class="esq-detalle__nombre">${esc(t.nombre)}</span><span class="esq-detalle__meta">${t.columnas.length} ${t.columnas.length === 1 ? 'columna' : 'columnas'}, ${
        t.filas === null ? 'sin conteo' : `${t.filas} ${t.filas === 1 ? 'registro' : 'registros'}`
      }</span></summary>
      <div class="esq-scroll"><table class="esq-tabla"><thead><tr><th>Columna</th><th>Tipo</th><th>Obligatoria</th><th>Clave</th></tr></thead>
      <tbody>${t.columnas
        .map(
          (c) =>
            `<tr><td>${esc(c.nombre)}</td><td>${esc(c.tipo)}</td><td>${c.requerida ? 'Sí' : 'No'}</td><td>${
              c.pk ? 'Primaria' : c.fk ? `Referencia a ${esc(c.fk)}` : ''
            }</td></tr>`,
        )
        .join('')}</tbody></table></div>
    </details>`,
    )
    .join('');

  const funciones = d.avanzado
    ? d.avanzado.funciones.map((f) => ({ nombre: f.nombre, detalle: f.argumentos, definer: f.security_definer }))
    : d.funciones_rpc.map((f) => ({ nombre: f.nombre, detalle: f.parametros.join(', '), definer: false }));
  $<HTMLElement>('#esq-funciones')!.innerHTML = funciones.length
    ? `<div class="esq-scroll"><table class="esq-tabla"><thead><tr><th>Función</th><th>Parámetros</th></tr></thead><tbody>${funciones
        .map((f) => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.detalle)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="admin-vacio">No se encontraron funciones.</p>';
}

async function cargar(token: string): Promise<void> {
  const error = $<HTMLElement>('#esq-error')!;
  const cargando = $<HTMLElement>('#esq-cargando')!;
  const contenido = $<HTMLElement>('#esq-contenido')!;
  const descargar = $<HTMLButtonElement>('#esq-descargar')!;
  error.hidden = true;
  cargando.hidden = false;
  descargar.disabled = true;

  try {
    const r = await fetch('/api/admin/esquema', { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401 || r.status === 403) throw new Error('Tu sesión no tiene permiso para ver el esquema. Vuelve a iniciar sesión.');
    if (!r.ok) throw new Error(`El servidor respondió con el código ${r.status}. Inténtalo nuevamente en unos minutos.`);
    ultimo = (await r.json()) as RespuestaEsquema;
    render(ultimo);
    contenido.hidden = false;
    descargar.disabled = false;
  } catch (e) {
    error.textContent = e instanceof Error ? e.message : 'No fue posible leer el esquema.';
    error.hidden = false;
  } finally {
    cargando.hidden = true;
  }
}

function descargarJson(): void {
  if (!ultimo) return;
  const blob = new Blob([JSON.stringify(ultimo, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `firehouse-esquema-${ultimo.generado_at.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function iniciarEsquema(): Promise<void> {
  const { supabase, perfil } = await requireAdminSession();
  montarCabeceraAdmin(perfil);

  const tokenActual = async () => (await supabase.auth.getSession()).data.session?.access_token ?? '';

  $<HTMLButtonElement>('#esq-actualizar')!.addEventListener('click', async () => cargar(await tokenActual()));
  $<HTMLButtonElement>('#esq-descargar')!.addEventListener('click', descargarJson);

  await cargar(await tokenActual());
}
