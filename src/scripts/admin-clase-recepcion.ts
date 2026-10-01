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
import {
  capitalizarNombre,
  datosPorCompletar,
  EDADES_EXPRESS,
  TALLA_NO_SABE,
  validarExpress,
  type DatosExpress,
  type FamiliaExistente,
  type NinoExpress,
  type RelacionExpress,
  type ResultadoExpress,
} from '../lib/crm/registro-express.ts';
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
  /**
   * Registro express de quien no está en la lista. Si el WhatsApp ya existe
   * devuelve duplicado: true; si se creó, devuelve además la lista actualizada.
   */
  registrarExpress?: (
    datos: DatosExpress,
    opciones: { apoderadoId?: string; forzarNuevo?: boolean },
  ) => Promise<{ resultado: ResultadoExpress; items?: ItemPrimeraClase[] }>;
  /** Abre directamente el formulario de registro express. */
  abrirEnExpress?: boolean;
}

export interface Recepcion {
  estadoGuardado: (e: EstadoGuardado) => void;
  /** Reemplaza la lista (por ejemplo, tras sincronizar con otro celular). */
  recargar: (items: ItemPrimeraClase[]) => void;
  /** true mientras se llena el registro express: no conviene refrescar. */
  ocupada: () => boolean;
}

interface FormExpress extends DatosExpress {
  errores: Record<string, string>;
  errorGeneral: string;
  duplicado: FamiliaExistente[] | null;
  enviando: boolean;
}

const RELACIONES: Array<[RelacionExpress, string]> = [
  ['MAMA', 'Mamá'],
  ['PAPA', 'Papá'],
  ['OTRO', 'Otro'],
];
const NOMBRE_SIMPLE = /^[\p{L}\p{M} '’-]{2,40}$/u;

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
  let items: ItemPrimeraClase[] = [];
  let porId = new Map<string, ItemPrimeraClase>();
  let personas: PersonaRecepcion[] = [];
  let letras: string[] = [];
  function cargar(nuevos: ItemPrimeraClase[]): void {
    items = nuevos;
    porId = new Map(items.map((i) => [i.caso.atleta.id, i]));
    personas = items.map((i) => ({
      id: i.caso.atleta.id,
      nombre: i.caso.atleta.nombre,
      apellidos: i.caso.atleta.apellidos,
      apoderado: `${i.caso.atleta.apoderado.nombre} ${i.caso.atleta.apoderado.apellidos}`,
    }));
    letras = letrasDisponibles(personas);
  }
  cargar(op.items);

  let texto = '';
  let letra: string | null = null;
  let modo: ModoRecepcion = 'POR_LLEGAR';
  /** Último deportista marcado: se muestra arriba con su talla y «Deshacer». */
  let ultimo: string | null = null;
  let tallaGuardada: string | null = null;
  /** Registro express en curso (null si el formulario está cerrado). */
  let form: FormExpress | null = null;
  /** Nombres recién registrados con el registro express, para avisar arriba. */
  let avisoExpress = '';

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
    <div class="rc__letras" role="group" aria-label="Filtrar por inicial del nombre"></div>
    <div class="rc__modos" role="group" aria-label="Mostrar">
      <button type="button" data-modo="POR_LLEGAR"></button>
      <button type="button" data-modo="LLEGARON"></button>
      <button type="button" data-modo="TODOS"></button>
    </div>
    <div class="rc__cuerpo">
      <section class="rc__ultimo" id="rc-ultimo" hidden aria-live="polite"></section>
      <ul class="rc__lista" id="rc-lista"></ul>
      <p class="rc__vacio" id="rc-vacio" hidden></p>
    </div>
    ${op.registrarExpress ? '<div class="rc__pie"><button type="button" class="rc__express-abrir" data-x-abrir>+ No está en la lista: registrar</button></div>' : ''}
    <form class="rc__form" id="rc-form" novalidate></form>`;
  document.body.appendChild(dlg);

  const $ = <T extends Element>(s: string) => dlg.querySelector<T>(s)!;
  const input = $<HTMLInputElement>('#rc-texto');
  const limpiar = $<HTMLButtonElement>('.rc__limpiar');
  const guardado = $<HTMLElement>('#rc-guardado');

  const presentes = () => new Set(items.filter((i) => op.estaPresente(i)).map((i) => i.caso.atleta.id));

  function filaHtml(p: PersonaRecepcion, llego: boolean): string {
    const item = porId.get(p.id)!;
    const a = item.caso.atleta;
    const edad = calcularEdad(a.fecha_nacimiento, new Date(`${op.fecha}T12:00:00Z`))?.edad;
    const rel = RELACION_APODERADO_LABEL[a.apoderado.relacion] ?? 'Apoderado/a';
    const kit = item.tipo !== 'PRUEBA' && item.caso.estado !== 'INSCRITO' ? ' · <span class="rc__kit">Kit pendiente</span>' : '';
    const completar = datosPorCompletar(a).length > 0 ? ' · <span class="rc__completar">Datos por completar</span>' : '';
    const detalle = `${edad !== undefined && edad !== null ? `${edad} años · ` : ''}${escaparHtml(tipoTexto(item))}${kit}${completar}`;
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
      ${avisoExpress ? `<p class="rc__ultimo-express">Registro express guardado: <b>${escaparHtml(avisoExpress)}</b>. Ya puedes entregar el sticker.</p>` : ''}
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
    $<HTMLElement>('.rc__letras').innerHTML = letras
      .map((l) => `<button type="button" data-letra="${l}" aria-pressed="${l === letra}">${l}</button>`)
      .join('');
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
          ? `Nadie por llegar con ese nombre. Revisa en «Todos»: puede que ya esté marcado o que tenga clase otro día.${op.registrarExpress ? ' Si no se inscribió, regístralo aquí abajo.' : ''}`
          : `No hay coincidencias.${op.registrarExpress ? ' Si no se inscribió, regístralo aquí abajo.' : ''}`
        : modo === 'POR_LLEGAR'
          ? '¡Llegaron todos!'
          : 'Todavía no llega nadie.';
  }

  function marcar(id: string, presente: boolean): void {
    const item = porId.get(id);
    if (!item) return;
    op.marcar(item, presente);
    avisoExpress = '';
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

  // -------------------------------------------------------------------------
  // Registro express: quien llega sin haberse inscrito.

  const formEl = $<HTMLFormElement>('#rc-form');
  const err = (clave: string) =>
    form?.errores[clave] ? `<p class="rc__campo-error" data-error="${clave}">${escaparHtml(form.errores[clave])}</p>` : '';

  function ninoHtml(n: NinoExpress, i: number, total: number): string {
    const chips = (attr: string, valores: Array<[string, string]>, actual: string | null) =>
      valores
        .map(([v, t]) => `<button type="button" ${attr}="${escaparHtml(v)}" data-nino="${i}" aria-pressed="${v === actual}">${escaparHtml(t)}</button>`)
        .join('');
    const tallas: Array<[string, string]> = [...op.tallas.map((t) => [t, t] as [string, string]), [TALLA_NO_SABE, 'No sabe']];
    return `
      <fieldset class="rc__nino">
        <legend>${total > 1 ? `Niña o niño ${i + 1}` : 'Niña o niño'}${
          total > 1 ? ` <button type="button" class="rc__link" data-x-quitar="${i}">Quitar</button>` : ''
        }</legend>
        <label class="rc__label" for="rc-x-nombre-${i}">Nombre</label>
        <input class="rc__input" id="rc-x-nombre-${i}" data-x-nombre="${i}" type="text" autocomplete="off" autocapitalize="words" spellcheck="false"
          enterkeyhint="done" maxlength="80" value="${escaparHtml(n.nombre)}" />
        ${err(`nino-${i}-nombre`)}
        <p class="rc__label" id="rc-x-edad-${i}">Edad</p>
        <div class="rc__chips" role="group" aria-labelledby="rc-x-edad-${i}">${chips(
          'data-x-edad',
          EDADES_EXPRESS.map((e) => [String(e), String(e)] as [string, string]),
          n.edad === null ? null : String(n.edad),
        )}</div>
        ${err(`nino-${i}-edad`)}
        <p class="rc__label" id="rc-x-talla-${i}">Talla de polera</p>
        <div class="rc__chips rc__chips--talla" role="group" aria-labelledby="rc-x-talla-${i}">${chips('data-x-talla', tallas, n.talla)}</div>
        ${err(`nino-${i}-talla`)}
      </fieldset>`;
  }

  function duplicadoHtml(): string {
    if (!form?.duplicado) return '';
    return `
      <div class="rc__dup" id="rc-dup" role="alert">
        <p><b>Ese WhatsApp ya está registrado.</b> Antes de crear otro registro, revisa si la niña ya está en la lista.</p>
        ${form.duplicado
          .map(
            (f) => `
          <div class="rc__dup-familia">
            <p><b>${escaparHtml(f.nombre)}</b>${f.atletas.length ? ` · ${escaparHtml(f.atletas.join(', '))}` : ''}</p>
            <button type="button" class="rc__boton rc__boton--sec" data-x-familia="${escaparHtml(f.id)}">Es su hermana o hermano: agregar a esta familia</button>
          </div>`,
          )
          .join('')}
        <button type="button" class="rc__boton rc__boton--sec" data-x-cancelar>Ya está en la lista: volver</button>
        <button type="button" class="rc__link" data-x-forzar>Es otra familia con el mismo número: registrar aparte</button>
      </div>`;
  }

  function dibujarForm(): void {
    if (!form) return;
    const f = form;
    formEl.innerHTML = `
      <div class="rc__form-cuerpo">
        <div>
          <p class="rc__form-titulo">Registro express</p>
          <p class="rc__form-sub">Para quien llegó sin inscribirse. Queda marcado como «llegó» y con sus datos por completar.</p>
        </div>
        ${f.ninos.map((n, i) => ninoHtml(n, i, f.ninos.length)).join('')}
        ${f.ninos.length < 6 ? '<button type="button" class="rc__boton rc__boton--sec" data-x-agregar>+ Agregar hermana o hermano</button>' : ''}
        <fieldset class="rc__nino">
          <legend>Apoderado</legend>
          <label class="rc__label" for="rc-x-apoderado">Nombre</label>
          <input class="rc__input" id="rc-x-apoderado" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" maxlength="80"
            value="${escaparHtml(f.apoderadoNombre)}" />
          ${err('apoderado')}
          <div class="rc__chips" role="group" aria-label="Relación con la niña o el niño">${RELACIONES.map(
            ([v, t]) => `<button type="button" data-x-rel="${v}" aria-pressed="${v === f.relacion}">${t}</button>`,
          ).join('')}</div>
          <label class="rc__label" for="rc-x-telefono">WhatsApp</label>
          <div class="rc__tel">
            <span aria-hidden="true">+56 9</span>
            <input class="rc__input" id="rc-x-telefono" type="tel" inputmode="numeric" autocomplete="off" enterkeyhint="done" maxlength="16"
              placeholder="1234 5678" aria-describedby="rc-x-tel-ayuda" value="${escaparHtml(f.telefono)}" />
          </div>
          <p class="rc__ayuda" id="rc-x-tel-ayuda">Los 8 dígitos después del 9.</p>
          ${err('telefono')}
          <label class="rc__consent">
            <input type="checkbox" id="rc-x-consent" ${f.consentimiento ? 'checked' : ''} />
            <span>El apoderado autorizó que Firehouse lo contacte por WhatsApp.</span>
          </label>
          ${err('consentimiento')}
        </fieldset>
        ${f.errorGeneral ? `<p class="rc__form-error" role="alert">${escaparHtml(f.errorGeneral)}</p>` : ''}
        ${duplicadoHtml()}
      </div>
      <div class="rc__form-acciones">
        <button type="button" class="rc__boton rc__boton--sec" data-x-cancelar>Cancelar</button>
        <button type="submit" class="rc__boton" ${f.enviando ? 'disabled' : ''}>${f.enviando ? 'Registrando…' : 'Registrar y marcar llegada'}</button>
      </div>`;
  }

  /** Pasa lo escrito al estado antes de volver a dibujar el formulario. */
  function leerForm(): void {
    if (!form) return;
    form.ninos.forEach((n, i) => {
      n.nombre = formEl.querySelector<HTMLInputElement>(`[data-x-nombre="${i}"]`)?.value ?? n.nombre;
    });
    form.apoderadoNombre = formEl.querySelector<HTMLInputElement>('#rc-x-apoderado')?.value ?? form.apoderadoNombre;
    form.telefono = formEl.querySelector<HTMLInputElement>('#rc-x-telefono')?.value ?? form.telefono;
    form.consentimiento = formEl.querySelector<HTMLInputElement>('#rc-x-consent')?.checked ?? form.consentimiento;
  }

  function abrirExpress(): void {
    // Si se buscó un nombre que no apareció, se aprovecha como nombre de la niña.
    const sugerido = NOMBRE_SIMPLE.test(texto.trim()) ? capitalizarNombre(texto) : '';
    form = {
      ninos: [{ nombre: sugerido, edad: null, talla: null }],
      apoderadoNombre: '',
      relacion: 'MAMA',
      telefono: '',
      consentimiento: false,
      errores: {},
      errorGeneral: '',
      duplicado: null,
      enviando: false,
    };
    dlg.classList.add('rc--express');
    dibujarForm();
    formEl.scrollTop = 0;
    if (!sugerido) formEl.querySelector<HTMLInputElement>('[data-x-nombre="0"]')?.focus();
  }

  function cerrarExpress(): void {
    form = null;
    formEl.innerHTML = '';
    dlg.classList.remove('rc--express');
    texto = '';
    letra = null;
    input.value = '';
    dibujar();
  }

  async function enviarExpress(opciones: { apoderadoId?: string; forzarNuevo?: boolean } = {}): Promise<void> {
    if (!form || form.enviando || !op.registrarExpress) return;
    leerForm();
    const f = form;
    f.errorGeneral = '';
    f.errores = validarExpress(f);
    if (Object.keys(f.errores).length > 0) {
      f.duplicado = null;
      dibujarForm();
      formEl.querySelector('.rc__campo-error')?.scrollIntoView({ block: 'center' });
      return;
    }
    f.enviando = true;
    dibujarForm();
    try {
      const { resultado, items: nuevos } = await op.registrarExpress(
        { ninos: f.ninos, apoderadoNombre: f.apoderadoNombre, relacion: f.relacion, telefono: f.telefono, consentimiento: f.consentimiento },
        opciones,
      );
      f.enviando = false;
      if (resultado.duplicado) {
        f.duplicado = resultado.existentes;
        dibujarForm();
        formEl.querySelector('#rc-dup')?.scrollIntoView({ block: 'center' });
        return;
      }
      if (nuevos) cargar(nuevos);
      const primero = resultado.atletas.find((a) => porId.has(a.atletaId));
      ultimo = primero?.atletaId ?? null;
      tallaGuardada = null;
      modo = 'POR_LLEGAR';
      cerrarExpress();
      avisoExpress = resultado.atletas.map((a) => a.nombre).join(' y ');
      dibujar();
      if (!primero) {
        guardado.className = 'rc__ok';
        guardado.textContent = `Registrado: ${avisoExpress} ✓`;
      }
      $<HTMLElement>('.rc__cuerpo').scrollTop = 0;
    } catch (e) {
      f.enviando = false;
      f.errorGeneral = e instanceof Error ? e.message : 'No pudimos registrar. Inténtalo de nuevo.';
      dibujarForm();
      formEl.querySelector('.rc__form-error')?.scrollIntoView({ block: 'center' });
    }
  }

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    void enviarExpress();
  });
  // «Listo» en el teclado no envía el formulario: solo oculta el teclado.
  formEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') {
      e.preventDefault();
      e.target.blur();
    }
  });
  formEl.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || !form) return;
    const grupo = (valor: string) => {
      t.parentElement?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
      formEl.querySelector(`[data-error="${valor}"]`)?.remove();
    };
    const i = Number(t.dataset.nino ?? -1);
    if (t.dataset.xEdad && form.ninos[i]) {
      form.ninos[i].edad = Number(t.dataset.xEdad);
      grupo(`nino-${i}-edad`);
    } else if (t.dataset.xTalla && form.ninos[i]) {
      form.ninos[i].talla = t.dataset.xTalla;
      grupo(`nino-${i}-talla`);
    } else if (t.dataset.xRel) {
      form.relacion = t.dataset.xRel as RelacionExpress;
      grupo('relacion');
    } else if (t.hasAttribute('data-x-agregar')) {
      leerForm();
      form.ninos.push({ nombre: '', edad: null, talla: null });
      dibujarForm();
      formEl.querySelector<HTMLInputElement>(`[data-x-nombre="${form.ninos.length - 1}"]`)?.focus();
    } else if (t.dataset.xQuitar) {
      leerForm();
      form.ninos.splice(Number(t.dataset.xQuitar), 1);
      form.errores = {};
      dibujarForm();
    } else if (t.hasAttribute('data-x-cancelar')) {
      cerrarExpress();
    } else if (t.dataset.xFamilia) {
      void enviarExpress({ apoderadoId: t.dataset.xFamilia });
    } else if (t.hasAttribute('data-x-forzar')) {
      void enviarExpress({ forzarNuevo: true });
    }
  });

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
    if (!t || t.closest('#rc-form')) return;
    if (t.hasAttribute('data-x-abrir')) {
      abrirExpress();
    } else if (t.dataset.letra) {
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
      // Con el registro express abierto, la X vuelve a la lista en vez de cerrar todo.
      if (form) cerrarExpress();
      else dlg.close();
    } else if (t.dataset.reintentar !== undefined) {
      op.reintentar();
    }
  });
  // Escape no debe botar un registro a medio escribir.
  dlg.addEventListener('cancel', (e) => {
    if (form) {
      e.preventDefault();
      cerrarExpress();
    }
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    op.alCerrar();
  });

  const api: Recepcion = {
    estadoGuardado(e) {
      guardado.className = e.tipo === 'error' ? 'rc__error' : e.tipo === 'ok' ? 'rc__ok' : '';
      guardado.innerHTML =
        e.tipo === 'error'
          ? `${escaparHtml(e.texto)} <button type="button" class="rc__link" data-reintentar>Reintentar</button>`
          : escaparHtml(e.texto);
    },
    recargar(nuevos) {
      cargar(nuevos);
      if (ultimo && !porId.has(ultimo)) ultimo = null;
      if (!form) dibujar();
    },
    ocupada: () => form !== null,
  };

  dibujar();
  dlg.showModal();
  if (op.abrirEnExpress && op.registrarExpress) abrirExpress();
  // En escritorio el cursor queda en el buscador; en el celular no se abre el teclado solo.
  else if (window.matchMedia('(min-width: 701px)').matches) input.focus();
  else (dlg.querySelector<HTMLElement>('.rc__cerrar') as HTMLElement).focus();

  return api;
}
