// Modo Recepción de Clase de hoy: pantalla para recibir a las familias en la
// puerta desde el celular. Buscador arriba (los resultados quedan visibles
// sobre el teclado), fila de iniciales para no abrir el teclado, botón
// «Llegó» grande y, al marcar, la talla de polera en un toque.

import type { ItemPrimeraClase } from '../lib/crm/admin-api.ts';
import { RELACION_APODERADO_LABEL } from '../lib/crm/constants.ts';
import { escaparHtml } from '../lib/crm/format.ts';
import {
  contarModos,
  filtrarRecepcion,
  letrasDisponibles,
  type ModoRecepcion,
  type PersonaRecepcion,
} from '../lib/crm/recepcion.ts';
import { calcularEdad } from '../lib/crm/validation.ts';

export type EstadoGuardado = { tipo: 'guardando' | 'ok' | 'error'; texto: string };

export interface OpcionesRecepcion {
  titulo: string;
  fecha: string;
  items: ItemPrimeraClase[];
  tallas: string[];
  tallaDe: (atletaId: string) => string | null;
  estaPresente: (item: ItemPrimeraClase) => boolean;
  /** Marca o desmarca y programa el guardado automático. */
  marcar: (item: ItemPrimeraClase, presente: boolean) => void;
  guardarTalla: (atletaId: string, talla: string) => Promise<void>;
  /** Reintenta el guardado si falló. */
  reintentar: () => void;
  alCerrar: () => void;
}

export interface Recepcion {
  estadoGuardado: (e: EstadoGuardado) => void;
}

const ICONO_CERRAR =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';

function tipoTexto(item: ItemPrimeraClase): string {
  if (item.tipo === 'PRUEBA') return item.caso.journey === 'CLASE_PRUEBA_STAR' ? 'Prueba Star' : 'Prueba';
  return item.tipo === 'INSCRIPCION' ? 'Star · 1ª clase' : 'Star';
}

/** "sáb 24 oct" a partir de YYYY-MM-DD. */
function fechaCortaTitulo(fecha: string): string {
  return new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${fecha}T12:00:00Z`))
    .replace(/[.,]/g, '');
}

export function abrirRecepcion(op: OpcionesRecepcion): Recepcion {
  const porId = new Map(op.items.map((i) => [i.caso.atleta.id, i]));
  const personas: PersonaRecepcion[] = op.items.map((i) => ({
    id: i.caso.atleta.id,
    nombre: i.caso.atleta.nombre,
    apellidos: i.caso.atleta.apellidos,
    apoderado: `${i.caso.atleta.apoderado.nombre} ${i.caso.atleta.apoderado.apellidos}`,
  }));
  const letras = letrasDisponibles(personas);

  let texto = '';
  let letra: string | null = null;
  let modo: ModoRecepcion = 'POR_LLEGAR';
  /** Último deportista marcado: se muestra arriba con su talla y «Deshacer». */
  let ultimo: string | null = null;
  let tallaGuardada: string | null = null;

  const dlg = document.createElement('dialog');
  dlg.className = 'rc';
  dlg.setAttribute('aria-labelledby', 'rc-titulo');
  dlg.innerHTML = `
    <div class="rc__cab">
      <div class="rc__cab-textos">
        <p class="rc__titulo" id="rc-titulo">Recepción · ${escaparHtml(fechaCortaTitulo(op.fecha))}</p>
        <p class="rc__sub"><span id="rc-conteo"></span> · <span id="rc-guardado" role="status">Cada llegada se guarda sola</span></p>
      </div>
      <button type="button" class="rc__cerrar" aria-label="Cerrar recepción">${ICONO_CERRAR}</button>
    </div>
    <div class="rc__buscar">
      <input id="rc-texto" type="search" inputmode="search" enterkeyhint="done" autocomplete="off" autocapitalize="none" spellcheck="false"
        placeholder="Nombre del niño o del apoderado" aria-label="Buscar por nombre" />
      <button type="button" class="rc__limpiar" aria-label="Borrar búsqueda" hidden>${ICONO_CERRAR}</button>
    </div>
    <div class="rc__letras" role="group" aria-label="Filtrar por inicial del nombre">
      ${letras.map((l) => `<button type="button" data-letra="${l}" aria-pressed="false">${l}</button>`).join('')}
    </div>
    <div class="rc__modos" role="group" aria-label="Mostrar">
      <button type="button" data-modo="POR_LLEGAR"></button>
      <button type="button" data-modo="LLEGARON"></button>
      <button type="button" data-modo="TODOS"></button>
    </div>
    <div class="rc__cuerpo">
      <section class="rc__ultimo" id="rc-ultimo" hidden aria-live="polite"></section>
      <ul class="rc__lista" id="rc-lista"></ul>
      <p class="rc__vacio" id="rc-vacio" hidden></p>
    </div>`;
  document.body.appendChild(dlg);

  const $ = <T extends Element>(s: string) => dlg.querySelector<T>(s)!;
  const input = $<HTMLInputElement>('#rc-texto');
  const limpiar = $<HTMLButtonElement>('.rc__limpiar');
  const guardado = $<HTMLElement>('#rc-guardado');

  const presentes = () => new Set(op.items.filter((i) => op.estaPresente(i)).map((i) => i.caso.atleta.id));

  function filaHtml(p: PersonaRecepcion, llego: boolean): string {
    const item = porId.get(p.id)!;
    const a = item.caso.atleta;
    const edad = calcularEdad(a.fecha_nacimiento, new Date(`${op.fecha}T12:00:00Z`))?.edad;
    const rel = RELACION_APODERADO_LABEL[a.apoderado.relacion] ?? 'Apoderado/a';
    const kit = item.tipo !== 'PRUEBA' && item.caso.estado !== 'INSCRITO' ? ' · <span class="rc__kit">Kit pendiente</span>' : '';
    const detalle = `${edad !== undefined && edad !== null ? `${edad} años · ` : ''}${escaparHtml(tipoTexto(item))}${kit}`;
    return `
      <li class="rc__fila${llego ? ' rc__fila--llego' : ''}">
        <span class="rc__textos">
          <span class="rc__nombre"><b>${escaparHtml(p.nombre)}</b> ${escaparHtml(p.apellidos)}</span>
          <span class="rc__detalle">${detalle}</span>
          <span class="rc__detalle">${escaparHtml(rel)}: ${escaparHtml(a.apoderado.nombre)}</span>
        </span>
        ${
          llego
            ? `<button type="button" class="rc__accion rc__accion--llego" data-deshacer="${escaparHtml(p.id)}" aria-label="Deshacer llegada de ${escaparHtml(p.nombre)}">✓ Llegó</button>`
            : `<button type="button" class="rc__accion" data-llego="${escaparHtml(p.id)}" aria-label="Marcar que llegó ${escaparHtml(p.nombre)}">Llegó</button>`
        }
      </li>`;
  }

  function ultimoHtml(): string {
    const item = ultimo ? porId.get(ultimo) : null;
    if (!item || !op.estaPresente(item)) return '';
    const a = item.caso.atleta;
    const talla = op.tallaDe(a.id);
    const tallas = talla && !op.tallas.includes(talla) ? [...op.tallas, talla] : op.tallas;
    const elegir = `<div class="rc__tallas" role="group" aria-label="Talla de polera de ${escaparHtml(a.nombre)}">${tallas
      .map((t) => `<button type="button" data-talla="${escaparHtml(t)}" aria-pressed="${t === talla}">${escaparHtml(t)}</button>`)
      .join('')}</div>`;
    const tallaTexto = talla
      ? `<p class="rc__ultimo-talla">Talla de polera: <b>${escaparHtml(talla)}</b>${tallaGuardada === talla ? ' · guardada ✓' : ''} <button type="button" class="rc__link" data-cambiar-talla>Cambiar</button></p>`
      : `<p class="rc__ultimo-talla">¿Qué talla de polera usa?</p>${elegir}`;
    return `
      <div class="rc__ultimo-cab">
        <p><b>✓ ${escaparHtml(a.nombre)} ${escaparHtml(a.apellidos)}</b> llegó</p>
        <button type="button" class="rc__link" data-deshacer="${escaparHtml(a.id)}">Deshacer</button>
      </div>
      ${tallaTexto}
      ${talla ? `<div class="rc__tallas-cambiar" hidden>${elegir}</div>` : ''}`;
  }

  function dibujar(): void {
    const pres = presentes();
    const c = contarModos(personas, pres);
    $<HTMLElement>('#rc-conteo').innerHTML = `<b>${c.LLEGARON} de ${c.TODOS}</b> llegaron`;
    const nombres: Record<ModoRecepcion, string> = { POR_LLEGAR: 'Por llegar', LLEGARON: 'Llegaron', TODOS: 'Todos' };
    dlg.querySelectorAll<HTMLButtonElement>('[data-modo]').forEach((b) => {
      const m = b.dataset.modo as ModoRecepcion;
      b.textContent = `${nombres[m]} · ${c[m]}`;
      b.setAttribute('aria-pressed', String(m === modo));
    });
    dlg.querySelectorAll<HTMLButtonElement>('[data-letra]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.letra === letra)));
    limpiar.hidden = !texto;

    const ult = $<HTMLElement>('#rc-ultimo');
    const htmlUlt = ultimoHtml();
    ult.innerHTML = htmlUlt;
    ult.hidden = !htmlUlt;

    // El recién llegado se muestra arriba; no se repite en la lista mientras no se busque a otro.
    const lista = filtrarRecepcion(personas, { texto, letra, modo, presentes: pres }).filter((p) => !(htmlUlt && p.id === ultimo && !texto && !letra));
    $<HTMLElement>('#rc-lista').innerHTML = lista.map((p) => filaHtml(p, pres.has(p.id))).join('');
    const vacio = $<HTMLElement>('#rc-vacio');
    vacio.hidden = lista.length > 0;
    vacio.textContent =
      texto || letra
        ? modo === 'POR_LLEGAR'
          ? 'Nadie por llegar con ese nombre. Revisa en «Todos»: puede que ya esté marcado o que tenga clase otro día.'
          : 'No hay coincidencias.'
        : modo === 'POR_LLEGAR'
          ? '¡Llegaron todos!'
          : 'Todavía no llega nadie.';
  }

  function marcar(id: string, presente: boolean): void {
    const item = porId.get(id);
    if (!item) return;
    op.marcar(item, presente);
    if (presente) {
      ultimo = id;
      tallaGuardada = null;
      // Lista lista para la siguiente familia: se borra la búsqueda.
      texto = '';
      letra = null;
      input.value = '';
      input.blur();
    } else if (ultimo === id) {
      ultimo = null;
    }
    dibujar();
    $<HTMLElement>('.rc__cuerpo').scrollTop = 0;
  }

  input.addEventListener('input', () => {
    texto = input.value;
    letra = null;
    dibujar();
  });
  // «Listo» en el teclado: lo oculta para ver la lista completa.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });
  limpiar.addEventListener('click', () => {
    texto = '';
    input.value = '';
    dibujar();
    input.focus();
  });
  dlg.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.letra) {
      letra = letra === t.dataset.letra ? null : t.dataset.letra;
      texto = '';
      input.value = '';
      input.blur();
      dibujar();
    } else if (t.dataset.modo) {
      modo = t.dataset.modo as ModoRecepcion;
      dibujar();
    } else if (t.dataset.llego) {
      marcar(t.dataset.llego, true);
    } else if (t.dataset.deshacer) {
      marcar(t.dataset.deshacer, false);
    } else if (t.hasAttribute('data-cambiar-talla')) {
      const caja = dlg.querySelector<HTMLElement>('.rc__tallas-cambiar');
      if (caja) caja.hidden = !caja.hidden;
    } else if (t.dataset.talla && ultimo) {
      const talla = t.dataset.talla;
      dlg.querySelectorAll<HTMLButtonElement>('[data-talla]').forEach((b) => (b.disabled = true));
      try {
        await op.guardarTalla(ultimo, talla);
        tallaGuardada = talla;
      } catch {
        guardado.textContent = 'No pudimos guardar la talla. Inténtalo de nuevo.';
        guardado.className = 'rc__error';
      }
      dibujar();
    } else if (t.classList.contains('rc__cerrar')) {
      dlg.close();
    } else if (t.dataset.reintentar !== undefined) {
      op.reintentar();
    }
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    op.alCerrar();
  });

  dibujar();
  dlg.showModal();
  // En escritorio el cursor queda en el buscador; en el celular no se abre el teclado solo.
  if (window.matchMedia('(min-width: 701px)').matches) input.focus();
  else (dlg.querySelector<HTMLElement>('.rc__cerrar') as HTMLElement).focus();

  return {
    estadoGuardado(e) {
      guardado.className = e.tipo === 'error' ? 'rc__error' : e.tipo === 'ok' ? 'rc__ok' : '';
      guardado.innerHTML =
        e.tipo === 'error'
          ? `${escaparHtml(e.texto)} <button type="button" class="rc__link" data-reintentar>Reintentar</button>`
          : escaparHtml(e.texto);
    },
  };
}
