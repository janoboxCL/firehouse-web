// Lógica del formulario público /registro. Progresiva: sin JS el formulario existe
// igual (validación HTML nativa), pero pierde los 3 pasos, el multi-atleta y el envío
// por fetch. Toda la clasificación de journey mostrada acá es sólo para UX — el servidor
// vuelve a calcularla y es la única fuente de verdad.

import { LIMITES, EXPERIENCIA_RANGOS_LABEL } from '../lib/crm/constants.ts';
import { proximasFechasClasePrueba, etiquetaFechaClasePrueba } from '../lib/crm/clase-prueba.ts';

const TOTAL_PASOS = 3;
const MAX_ATLETAS = LIMITES.MAX_ATLETAS_POR_REGISTRO;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function evento(nombre: string, params: Record<string, unknown> = {}): void {
  if (typeof window.gtag === 'function') {
    window.gtag('event', nombre, params);
  }
}

function $<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}
function $all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function crearElementoDesdeHTML(html: string): HTMLElement {
  const plantilla = document.createElement('template');
  plantilla.innerHTML = html.trim();
  return plantilla.content.firstElementChild as HTMLElement;
}

function calcularEdadDesde(fechaISO: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return null;
  const nacimiento = new Date(`${fechaISO}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  if (nacimiento.getTime() > hoy.getTime()) return null;
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const noHaCumplido =
    hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
  if (noHaCumplido) edad -= 1;
  return edad >= 0 ? edad : null;
}

function opcionesExperiencia(): string {
  return Object.entries(EXPERIENCIA_RANGOS_LABEL)
    .map(([valor, etiqueta]) => `<option value="${valor}">${etiqueta}</option>`)
    .join('');
}

function opcionesFechaClasePrueba(): string {
  return proximasFechasClasePrueba(8)
    .map((fecha) => `<option value="${fecha}">${etiquetaFechaClasePrueba(fecha)}</option>`)
    .join('');
}

let contadorAtletas = 0;

function plantillaAtleta(numero: number): string {
  const idBase = `atleta-${numero}`;
  return `
  <fieldset class="atleta-card" data-atleta-card>
    <div class="atleta-card__cabecera">
      <p class="atleta-card__titulo">Atleta ${numero}</p>
      <button type="button" class="atleta-card__eliminar" data-accion="eliminar-atleta">Eliminar atleta</button>
    </div>

    <div class="campo">
      <label for="${idBase}-nombre">Nombre</label>
      <input id="${idBase}-nombre" type="text" maxlength="80" required data-campo="nombre" autocomplete="given-name" />
    </div>

    <div class="campo">
      <label for="${idBase}-apellidos">Apellidos</label>
      <input id="${idBase}-apellidos" type="text" maxlength="120" required data-campo="apellidos" autocomplete="family-name" />
    </div>

    <div class="campo">
      <label for="${idBase}-nacimiento">Fecha de nacimiento</label>
      <input id="${idBase}-nacimiento" type="date" required data-campo="fechaNacimiento" max="${new Date().toISOString().slice(0, 10)}" />
      <p class="campo__ayuda" data-edad-preview></p>
    </div>

    <div class="campo">
      <p class="campo__label">¿Actualmente entrena en Firehouse?</p>
      <div class="pills" data-grupo="firehouseActual">
        <label class="pill"><input type="radio" name="${idBase}-firehouse" value="si" required /> Sí</label>
        <label class="pill"><input type="radio" name="${idBase}-firehouse" value="no" /> No</label>
      </div>
    </div>

    <div class="atleta-card__bloque" data-bloque="firehouse-si" hidden>
      <p class="campo__label">Pensando en 2027, ¿qué están decidiendo?</p>
      <div class="pills" data-grupo="intencionInicial">
        <label class="pill"><input type="radio" name="${idBase}-intencion" value="CONTINUAR" /> Continuar en Firehouse durante 2027</label>
        <label class="pill"><input type="radio" name="${idBase}-intencion" value="INDECISO" /> Todavía no lo tenemos decidido</label>
      </div>
    </div>

    <div class="atleta-card__bloque" data-bloque="firehouse-no" hidden>
      <div class="campo">
        <p class="campo__label">¿Ha practicado cheerleading anteriormente?</p>
        <div class="pills" data-grupo="tieneExperiencia">
          <label class="pill"><input type="radio" name="${idBase}-experiencia" value="si" /> Sí</label>
          <label class="pill"><input type="radio" name="${idBase}-experiencia" value="no" /> No</label>
        </div>
      </div>

      <div class="atleta-card__bloque" data-bloque="experiencia-detalle" hidden>
        <div class="campo">
          <label for="${idBase}-anios">¿Cuánto tiempo aproximadamente?</label>
          <select id="${idBase}-anios" data-campo="aniosExperiencia">
            <option value="">Selecciona una opción</option>
            ${opcionesExperiencia()}
          </select>
        </div>
        <div class="campo">
          <label for="${idBase}-academia">Academia o equipo anterior <span class="campo__opcional">(opcional)</span></label>
          <input id="${idBase}-academia" type="text" maxlength="120" data-campo="academiaAnterior" />
        </div>
      </div>

      <div class="campo">
        <p class="campo__label">¿Qué alternativa les interesa principalmente?</p>
        <div class="tarjetas-interes" data-grupo="interes">
          <label class="tarjeta-interes">
            <input type="radio" name="${idBase}-interes" value="PRETEMPORADA" />
            <span class="tarjeta-interes__titulo">🔥 Pretemporada Firehouse</span>
            <span class="tarjeta-interes__texto">Diciembre y enero. Una forma entretenida de conocer el cheer y Firehouse durante las vacaciones.</span>
          </label>
          <label class="tarjeta-interes">
            <input type="radio" name="${idBase}-interes" value="TEMPORADA_2027" />
            <span class="tarjeta-interes__titulo">⭐ Temporada Firehouse 2027</span>
            <span class="tarjeta-interes__texto">Desde marzo. Queremos conocer las opciones para incorporarse a los equipos Firehouse 2027.</span>
          </label>
          <label class="tarjeta-interes">
            <input type="radio" name="${idBase}-interes" value="NO_SEGURO" />
            <span class="tarjeta-interes__titulo">❓ Todavía no estamos seguros</span>
            <span class="tarjeta-interes__texto">Preferimos que Firehouse nos oriente.</span>
          </label>
        </div>
      </div>

      <div class="campo">
        <p class="campo__label">¿Quieren venir a una clase de prueba antes de decidir?</p>
        <div class="pills" data-grupo="quiereClasePrueba">
          <label class="pill"><input type="radio" name="${idBase}-clase-prueba" value="si" /> Sí</label>
          <label class="pill"><input type="radio" name="${idBase}-clase-prueba" value="no" /> No, todavía no</label>
        </div>
      </div>

      <div class="atleta-card__bloque" data-bloque="fecha-clase-prueba" hidden>
        <div class="campo">
          <label for="${idBase}-fecha-clase">¿Qué día?</label>
          <select id="${idBase}-fecha-clase" data-campo="fechaClasePrueba" required>
            <option value="">Selecciona una fecha</option>
            ${opcionesFechaClasePrueba()}
          </select>
        </div>
      </div>
    </div>
  </fieldset>`;
}

function actualizarRequeridosBloque(bloque: HTMLElement, activo: boolean): void {
  bloque.hidden = !activo;
  $all<HTMLInputElement | HTMLSelectElement>('input, select', bloque).forEach((el) => {
    if (el.dataset.siempreOpcional) return;
    if (el.type === 'radio') return; // los radios de un grupo se validan a mano, no con required masivo
    if (!activo) el.removeAttribute('required');
  });
}

function inicializarTarjetaAtleta(card: HTMLElement, numero: number): void {
  const bloqueSi = $<HTMLElement>('[data-bloque="firehouse-si"]', card)!;
  const bloqueNo = $<HTMLElement>('[data-bloque="firehouse-no"]', card)!;
  const bloqueExperienciaDetalle = $<HTMLElement>('[data-bloque="experiencia-detalle"]', card)!;
  const bloqueFechaClasePrueba = $<HTMLElement>('[data-bloque="fecha-clase-prueba"]', card)!;

  $all<HTMLInputElement>('[data-grupo="firehouseActual"] input', card).forEach((radio) => {
    radio.addEventListener('change', () => {
      const esActual = radio.value === 'si' && radio.checked;
      if (radio.checked) {
        bloqueSi.hidden = !esActual;
        bloqueNo.hidden = esActual;
        if (esActual) bloqueExperienciaDetalle.hidden = true;
      }
    });
  });

  $all<HTMLInputElement>('[data-grupo="tieneExperiencia"] input', card).forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) actualizarRequeridosBloque(bloqueExperienciaDetalle, radio.value === 'si');
    });
  });

  $all<HTMLInputElement>('[data-grupo="quiereClasePrueba"] input', card).forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) actualizarRequeridosBloque(bloqueFechaClasePrueba, radio.value === 'si');
    });
  });

  const fechaInput = $<HTMLInputElement>('[data-campo="fechaNacimiento"]', card)!;
  const edadPreview = $('[data-edad-preview]', card)!;
  fechaInput.addEventListener('change', () => {
    const edad = calcularEdadDesde(fechaInput.value);
    edadPreview.textContent = edad === null ? '' : `${edad} ${edad === 1 ? 'año' : 'años'}`;
  });

  const tituloEl = $('.atleta-card__titulo', card)!;
  const btnEliminar = $('[data-accion="eliminar-atleta"]', card)!;
  btnEliminar.addEventListener('click', () => eliminarAtleta(card));

  card.dataset.numero = String(numero);
  tituloEl.textContent = `Atleta ${numero}`;
}

function renumerarAtletas(): void {
  const cards = $all<HTMLElement>('[data-atleta-card]');
  cards.forEach((card, i) => {
    const numero = i + 1;
    card.dataset.numero = String(numero);
    const titulo = $('.atleta-card__titulo', card);
    if (titulo) titulo.textContent = `Atleta ${numero}`;
    const btnEliminar = $<HTMLButtonElement>('[data-accion="eliminar-atleta"]', card);
    if (btnEliminar) btnEliminar.hidden = cards.length <= 1;
  });
  const btnAgregar = $<HTMLButtonElement>('#btn-agregar-atleta');
  if (btnAgregar) btnAgregar.hidden = cards.length >= MAX_ATLETAS;
}

function agregarAtleta(): void {
  const lista = $('#atletas-lista');
  if (!lista) return;
  contadorAtletas += 1;
  const card = crearElementoDesdeHTML(plantillaAtleta(contadorAtletas));
  lista.appendChild(card);
  inicializarTarjetaAtleta(card, contadorAtletas);
  renumerarAtletas();
}

function eliminarAtleta(card: HTMLElement): void {
  const total = $all('[data-atleta-card]').length;
  if (total <= 1) return; // siempre debe quedar al menos un/a atleta
  card.remove();
  renumerarAtletas();
}

// ---------------------------------------------------------------------------
// Navegación entre pasos
// ---------------------------------------------------------------------------

let pasoActual = 1;
let inicioRegistrado = false;

function mostrarPaso(n: number): void {
  pasoActual = n;
  $all<HTMLElement>('[data-paso]').forEach((seccion) => {
    seccion.hidden = Number(seccion.dataset.paso) !== n;
  });
  $all<HTMLElement>('[data-progreso-item]').forEach((item) => {
    const num = Number(item.dataset.progresoItem);
    item.classList.toggle('activo', num === n);
    item.classList.toggle('completado', num < n);
  });
  const textoPaso = $('#texto-paso');
  if (textoPaso) textoPaso.textContent = `Paso ${n} de ${TOTAL_PASOS}`;
  const form = $('#form-registro');
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function validarPasoActual(): boolean {
  const seccion = $<HTMLFieldSetElement>(`[data-paso="${pasoActual}"]`);
  if (!seccion) return true;

  // Los radios de "interés" y "tiene experiencia" viven dentro de bloques que pueden estar
  // ocultos; sólo exigimos los que son visibles y pertenecen a atletas cuyo bloque aplica.
  let valido = (seccion as HTMLFieldSetElement).reportValidity
    ? Array.from(seccion.querySelectorAll('input, select, textarea')).every((el) => {
        const input = el as HTMLInputElement;
        if (input.offsetParent === null && input.type !== 'hidden') return true; // oculto, no bloquea
        return input.checkValidity();
      })
    : true;

  if (pasoActual === 2) {
    $all<HTMLElement>('[data-atleta-card]').forEach((card) => {
      const bloqueNo = $<HTMLElement>('[data-bloque="firehouse-no"]', card);
      const firehouseElegido = $all<HTMLInputElement>('[data-grupo="firehouseActual"] input', card).some((r) => r.checked);
      if (!firehouseElegido) valido = false;

      if (bloqueNo && !bloqueNo.hidden) {
        const interesElegido = $all<HTMLInputElement>('[data-grupo="interes"] input', card).some((r) => r.checked);
        if (!interesElegido) valido = false;

        const clasePruebaElegida = $all<HTMLInputElement>('[data-grupo="quiereClasePrueba"] input', card).some((r) => r.checked);
        if (!clasePruebaElegida) valido = false;
      }
    });
  }

  if (!valido) {
    seccion.reportValidity?.();
    const primerInvalido = $<HTMLInputElement>(':invalid', seccion);
    primerInvalido?.focus();
  }
  return valido;
}

function irASiguientePaso(): void {
  if (!validarPasoActual()) return;
  if (pasoActual === 1) evento('registration_step_1_completed');
  if (pasoActual === 2) evento('registration_step_2_completed');
  if (pasoActual < TOTAL_PASOS) mostrarPaso(pasoActual + 1);
}

function irAPasoAnterior(): void {
  if (pasoActual > 1) mostrarPaso(pasoActual - 1);
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

function valorRadioSeleccionado(nombre: string, root: ParentNode = document): string | null {
  const el = root.querySelector<HTMLInputElement>(`input[name="${nombre}"]:checked`);
  return el ? el.value : null;
}

function leerAtleta(card: HTMLElement) {
  const firehouseActual = valorRadioSeleccionado(
    $<HTMLInputElement>('[data-grupo="firehouseActual"] input', card)!.name,
    card,
  ) === 'si';

  const base = {
    nombre: $<HTMLInputElement>('[data-campo="nombre"]', card)!.value,
    apellidos: $<HTMLInputElement>('[data-campo="apellidos"]', card)!.value,
    fechaNacimiento: $<HTMLInputElement>('[data-campo="fechaNacimiento"]', card)!.value,
    firehouseActual,
    intencionInicial: null as string | null,
    tieneExperiencia: null as boolean | null,
    aniosExperiencia: null as string | null,
    academiaAnterior: null as string | null,
    interes: null as string | null,
    quiereClasePrueba: false,
    fechaClasePrueba: null as string | null,
  };

  if (firehouseActual) {
    const grupo = $<HTMLInputElement>('[data-grupo="intencionInicial"] input', card);
    base.intencionInicial = grupo ? valorRadioSeleccionado(grupo.name, card) : null;
  } else {
    const grupoExp = $<HTMLInputElement>('[data-grupo="tieneExperiencia"] input', card);
    const experiencia = grupoExp ? valorRadioSeleccionado(grupoExp.name, card) : null;
    base.tieneExperiencia = experiencia === 'si';
    if (experiencia === 'si') {
      const anios = $<HTMLSelectElement>('[data-campo="aniosExperiencia"]', card);
      base.aniosExperiencia = anios?.value || null;
      const academia = $<HTMLInputElement>('[data-campo="academiaAnterior"]', card);
      base.academiaAnterior = academia?.value || null;
    }
    const grupoInteres = $<HTMLInputElement>('[data-grupo="interes"] input', card);
    base.interes = grupoInteres ? valorRadioSeleccionado(grupoInteres.name, card) : null;

    const grupoClasePrueba = $<HTMLInputElement>('[data-grupo="quiereClasePrueba"] input', card);
    const quiereClase = grupoClasePrueba ? valorRadioSeleccionado(grupoClasePrueba.name, card) : null;
    base.quiereClasePrueba = quiereClase === 'si';
    if (base.quiereClasePrueba) {
      const fecha = $<HTMLSelectElement>('[data-campo="fechaClasePrueba"]', card);
      base.fechaClasePrueba = fecha?.value || null;
    }
  }

  return base;
}

function textoResultado(nombres: string[]): string {
  if (nombres.length === 0) return 'Recibimos tu registro correctamente.';
  if (nombres.length === 1) return `Recibimos el registro de ${nombres[0]}.`;
  return `Recibimos el registro de ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}.`;
}

async function enviarRegistro(evt: SubmitEvent): Promise<void> {
  evt.preventDefault();
  if (!validarPasoActual()) return;

  const consent = $<HTMLInputElement>('#f-consent');
  if (!consent?.checked) {
    consent?.reportValidity();
    consent?.focus();
    return;
  }

  const btnEnviar = $<HTMLButtonElement>('#btn-enviar');
  const bannerError = $<HTMLElement>('#error-envio');
  if (!btnEnviar) return;
  if (btnEnviar.disabled) return; // evita doble envío por doble clic

  btnEnviar.disabled = true;
  btnEnviar.classList.add('cargando');
  const textoOriginal = btnEnviar.textContent;
  btnEnviar.textContent = 'Enviando…';
  if (bannerError) bannerError.hidden = true;

  evento('registration_submitted');

  const submissionId = ($('#f-submission-id') as HTMLInputElement).value;
  const formStartedAtMs = Number(($('#f-started-at') as HTMLInputElement).value);
  const honeypot = ($('#f-honeypot') as HTMLInputElement).value;

  const payload = {
    submissionId,
    honeypot,
    formStartedAtMs,
    apoderado: {
      nombre: $<HTMLInputElement>('#f-nombre')!.value,
      apellidos: $<HTMLInputElement>('#f-apellidos')!.value,
      telefono: $<HTMLInputElement>('#f-telefono')!.value,
      telefonoSecundario: $<HTMLInputElement>('#f-telefono-secundario')?.value || '',
      email: $<HTMLInputElement>('#f-email')!.value,
      relacion: valorRadioSeleccionado('relacion'),
      comuna: leerComunaSeleccionada(),
      comoConocio: $<HTMLSelectElement>('#f-como-conocio')!.value,
      canalPreferido: valorRadioSeleccionado('canalPreferido'),
      comentarioInicial: $<HTMLTextAreaElement>('#f-comentario')?.value || '',
      consentContact: true,
    },
    atletas: $all<HTMLElement>('[data-atleta-card]').map(leerAtleta),
  };

  try {
    const res = await fetch('/api/registro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      if (res.status === 429) {
        mostrarError('Estamos recibiendo muchas solicitudes. Espera unos minutos e inténtalo de nuevo.');
      } else if (res.status === 400 && data?.fields?.length) {
        mostrarError('Revisa la información ingresada e inténtalo nuevamente.');
      } else {
        mostrarError('No pudimos guardar el registro. Revisa tu conexión e inténtalo nuevamente.');
      }
      evento('registration_error', { status: res.status });
      return;
    }

    const data = await res.json();
    mostrarExito(data.atletas ?? []);
    evento('registration_success');
  } catch {
    mostrarError('No pudimos guardar el registro. Revisa tu conexión e inténtalo nuevamente.');
    evento('registration_error', { status: 0 });
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.classList.remove('cargando');
    btnEnviar.textContent = textoOriginal;
  }
}

function mostrarError(mensaje: string): void {
  const banner = $<HTMLElement>('#error-envio');
  if (!banner) return;
  banner.textContent = mensaje;
  banner.hidden = false;
  banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function mostrarExito(nombres: string[]): void {
  const form = $<HTMLElement>('#form-registro');
  const cabecera = $<HTMLElement>('#form-cabecera');
  const exito = $<HTMLElement>('#pantalla-exito');
  if (form) form.hidden = true;
  if (cabecera) cabecera.hidden = true;
  if (exito) {
    exito.hidden = false;
    const parrafo = $('#exito-texto', exito);
    if (parrafo) parrafo.textContent = textoResultado(nombres);
    exito.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------------------------------------------------------------------------
// Mejoras de llenado: máscara de teléfono, feedback de correo, comuna RM/otra,
// y estilos de error que sólo aparecen después de que la persona tocó el campo.
// ---------------------------------------------------------------------------

const EMAIL_RE_UI = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatearTelefonoInput(input: HTMLInputElement | null): void {
  if (!input) return;
  input.addEventListener('input', () => {
    const digitos = input.value.replace(/\D/g, '').slice(0, 9);
    if (digitos.length > 5) {
      input.value = `${digitos.slice(0, 1)} ${digitos.slice(1, 5)} ${digitos.slice(5)}`;
    } else if (digitos.length > 1) {
      input.value = `${digitos.slice(0, 1)} ${digitos.slice(1)}`;
    } else {
      input.value = digitos;
    }
  });
}

function inicializarFeedbackEmail(): void {
  const input = $<HTMLInputElement>('#f-email');
  const feedback = $<HTMLElement>('#email-feedback');
  if (!input || !feedback) return;

  const actualizar = () => {
    const valor = input.value.trim();
    feedback.classList.remove('valido', 'invalido');
    if (!valor) {
      feedback.textContent = '';
      return;
    }
    if (EMAIL_RE_UI.test(valor)) {
      feedback.textContent = '✓ Correo válido';
      feedback.classList.add('valido');
    } else {
      feedback.textContent = 'Revisa el formato (ejemplo@correo.com)';
      feedback.classList.add('invalido');
    }
  };
  input.addEventListener('input', actualizar);
  input.addEventListener('blur', actualizar);
}

function leerComunaSeleccionada(): string {
  const select = $<HTMLSelectElement>('#f-comuna-rm');
  if (!select) return '';
  if (select.value === 'OTRA') {
    return $<HTMLInputElement>('#f-comuna-otra')?.value ?? '';
  }
  return select.value;
}

function inicializarComunaOtra(): void {
  const select = $<HTMLSelectElement>('#f-comuna-rm');
  const wrap = $<HTMLElement>('#comuna-otra-wrap');
  const input = $<HTMLInputElement>('#f-comuna-otra');
  if (!select || !wrap || !input) return;

  select.addEventListener('change', () => {
    const esOtra = select.value === 'OTRA';
    wrap.hidden = !esOtra;
    if (esOtra) {
      input.setAttribute('required', 'required');
      input.focus();
    } else {
      input.removeAttribute('required');
      input.value = '';
    }
  });
}

/** Agrega la clase .tocado a un campo recién editado, para que el estilo de
 * "campo inválido" sólo aparezca después de que la persona ya interactuó con él
 * (nunca antes de que alcance a escribir nada). */
function inicializarEstadoTocado(form: HTMLFormElement): void {
  form.addEventListener(
    'blur',
    (evt) => {
      const el = evt.target as HTMLElement;
      if (el.matches?.('input, select, textarea')) el.classList.add('tocado');
    },
    true, // fase de captura: blur no burbujea
  );
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

function marcarInicio(): void {
  if (inicioRegistrado) return;
  inicioRegistrado = true;
  evento('registration_started');
}

function inicializarContadorComentario(): void {
  const textarea = $<HTMLTextAreaElement>('#f-comentario');
  const contador = $('#contador-comentario');
  if (!textarea || !contador) return;
  const actualizar = () => {
    contador.textContent = `${textarea.value.length} / ${LIMITES.COMENTARIO_INICIAL_MAX}`;
  };
  textarea.addEventListener('input', actualizar);
  actualizar();
}

export function iniciarFormularioRegistro(): void {
  const form = $<HTMLFormElement>('#form-registro');
  if (!form) return;

  ($('#f-submission-id') as HTMLInputElement).value = crypto.randomUUID();
  ($('#f-started-at') as HTMLInputElement).value = String(Date.now());

  agregarAtleta();

  $('#btn-agregar-atleta')?.addEventListener('click', agregarAtleta);
  $all('[data-accion="siguiente"]').forEach((btn) => btn.addEventListener('click', irASiguientePaso));
  $all('[data-accion="atras"]').forEach((btn) => btn.addEventListener('click', irAPasoAnterior));
  form.addEventListener('submit', enviarRegistro);
  form.addEventListener(
    'focusin',
    () => marcarInicio(),
    { once: true },
  );

  formatearTelefonoInput($<HTMLInputElement>('#f-telefono'));
  formatearTelefonoInput($<HTMLInputElement>('#f-telefono-secundario'));
  inicializarFeedbackEmail();
  inicializarComunaOtra();
  inicializarEstadoTocado(form);
  inicializarContadorComentario();
  mostrarPaso(1);
}
