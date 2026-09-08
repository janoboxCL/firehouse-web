// Envío del correo de confirmación vía Resend (https://resend.com).
// Este envío es "best effort": si falla, NUNCA debe hacer fallar el registro,
// que ya quedó guardado correctamente en la base de datos antes de llegar acá.

export interface DatosCorreoConfirmacion {
  apoderadoNombre: string;
  apoderadoEmail: string;
  nombresAtletas: string[];
  /** Si alguien de la familia pidió clase de prueba, el correo cambia de tono
   * y contenido — deja de ser un "recibimos tu registro" genérico. */
  claseDePrueba?: { dia: string; fecha: string } | null;
}

const HORARIO_POR_DIA: Record<string, string> = {
  VIERNES: 'Cheer, 18:00–20:00 hrs',
  SABADO: 'Gimnasia, 16:00–18:00 hrs',
};

const NOMBRE_DIA: Record<string, string> = { VIERNES: 'viernes', SABADO: 'sábado' };

function textoAtletas(nombres: string[]): string {
  if (nombres.length === 1) return nombres[0];
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`;
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plantillaBase(preTitulo: string, titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es-CL">
<body style="margin:0;padding:32px 16px;background:#171412;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#201D1B;border-radius:16px;padding:36px 32px;color:#F5EFE8;">
    <p style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#FFC400;margin:0 0 18px;font-weight:bold;">
      ${preTitulo}
    </p>
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px;color:#F5EFE8;">${titulo}</h1>
    ${cuerpo}
    <a href="https://firehousecheer.cl"
       style="display:inline-block;background:#C51515;color:#ffffff;text-decoration:none;
              padding:13px 28px;border-radius:999px;font-size:14px;font-weight:500;">
      Visitar firehousecheer.cl
    </a>
    <p style="font-size:12px;line-height:1.6;color:rgba(245,239,232,.5);margin-top:36px;">
      Firehouse Cheerleading All Stars · Santa Corina 197, La Cisterna, Santiago<br />
      Si no reconoces este registro, puedes ignorar este correo.
    </p>
  </div>
</body>
</html>`;
}

function formatearFechaEmail(fechaISO: string): string {
  try {
    const fecha = new Date(`${fechaISO}T00:00:00`);
    return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long' }).format(fecha);
  } catch {
    return fechaISO;
  }
}

function construirHtml(datos: DatosCorreoConfirmacion): string {
  const nombres = escaparHtml(textoAtletas(datos.nombresAtletas));
  const nombreApoderado = escaparHtml(datos.apoderadoNombre.split(' ')[0]);

  if (datos.claseDePrueba) {
    const diaNombre = NOMBRE_DIA[datos.claseDePrueba.dia] ?? datos.claseDePrueba.dia.toLowerCase();
    const horario = HORARIO_POR_DIA[datos.claseDePrueba.dia] ?? '';
    const fechaLegible = formatearFechaEmail(datos.claseDePrueba.fecha);
    const cuerpo = `
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 16px;">
      Hola ${nombreApoderado}, recibimos la solicitud de clase de prueba para <strong>${nombres}</strong>.
    </p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 8px;">
      📅 <strong>${diaNombre.charAt(0).toUpperCase() + diaNombre.slice(1)} ${fechaLegible}</strong>${horario ? ` · ${horario}` : ''}
    </p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 28px;">
      Nos comunicaremos contigo para confirmar todos los detalles antes de esa fecha. ¡Los esperamos! 🔥
    </p>`;
    return plantillaBase('Firehouse Cheerleading All Stars', '¡Recibimos tu solicitud de clase de prueba! 📅', cuerpo);
  }

  const cuerpo = `
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 16px;">
      Hola ${nombreApoderado}, gracias por registrar a <strong>${nombres}</strong> en Firehouse.
    </p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 28px;">
      Revisaremos la información y nos comunicaremos contigo pronto para orientarte sobre la
      alternativa más adecuada para tu familia: Pretemporada, la temporada 2027, o lo que mejor
      les acomode.
    </p>`;
  return plantillaBase('Firehouse Cheerleading All Stars', '¡Recibimos tu registro! 🔥', cuerpo);
}

/** Copia oculta por defecto en todo correo que sale del CRM. Se puede reemplazar
 * con la variable de entorno EMAIL_BCC (lista separada por comas) sin tocar código. */
const BCC_POR_DEFECTO = ['ben.beltran.m@gmail.com', 'alejandro.cespedesd@gmail.com'];

export function resolverBcc(valorEnv: string | undefined): string[] {
  if (!valorEnv) return BCC_POR_DEFECTO;
  const lista = valorEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return lista.length > 0 ? lista : BCC_POR_DEFECTO;
}

/** Llamada cruda a la API de Resend. La usan tanto el correo de confirmación
 * automático como el envío manual desde el panel admin. */
export async function enviarCorreoGenerico(
  apiKey: string,
  remitente: string,
  destinatario: string,
  asunto: string,
  html: string,
  bcc?: string[],
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: remitente,
      to: destinatario,
      subject: asunto,
      html,
      ...(bcc && bcc.length > 0 ? { bcc } : {}),
    }),
  });

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(`resend_http_${res.status}: ${cuerpo.slice(0, 200)}`);
  }
}

/**
 * Envía el correo de confirmación. Lanza si Resend responde con error — el
 * caller decide qué hacer (normalmente: loguear y seguir, nunca romper el flujo).
 */
export async function enviarCorreoConfirmacion(
  apiKey: string,
  remitente: string,
  datos: DatosCorreoConfirmacion,
  bcc?: string[],
): Promise<void> {
  const asunto = datos.claseDePrueba
    ? '¡Recibimos tu solicitud de clase de prueba! 📅'
    : '¡Recibimos tu registro en Firehouse! 🔥';
  await enviarCorreoGenerico(apiKey, remitente, datos.apoderadoEmail, asunto, construirHtml(datos), bcc);
}

// ---------------------------------------------------------------------------
// Correo de confirmación de compra — Gran Concurso Firehouse
// ---------------------------------------------------------------------------

export interface DatosCorreoRifa {
  compradorNombre: string;
  compradorEmail: string;
  numeros: number[];
  monto: number;
  commerceOrder: string;
  /** timestamp ISO de rifa_config.fecha_sorteo — opcional, puede no estar definida aún. */
  fechaSorteo?: string | null;
}

function construirHtmlRifa(datos: DatosCorreoRifa): string {
  const nombre = escaparHtml(datos.compradorNombre.split(' ')[0]);
  const numerosTexto = [...datos.numeros]
    .sort((a, b) => a - b)
    .map((n) => `#${String(n).padStart(3, '0')}`)
    .join(' · ');
  const montoTexto = `$${datos.monto.toLocaleString('es-CL')}`;

  let fechaTexto = '';
  if (datos.fechaSorteo) {
    try {
      fechaTexto = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(datos.fechaSorteo),
      );
    } catch {
      fechaTexto = '';
    }
  }

  const cuerpo = `
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 16px;">
      Hola ${nombre}, ¡gracias por apoyar a Firehouse! 🔥
    </p>
    <p style="font-size:16px;line-height:1.65;color:#FFC400;font-weight:bold;margin:0 0 8px;">
      Tus números: ${numerosTexto}
    </p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 8px;">
      Monto pagado: <strong>${montoTexto}</strong>
    </p>
    ${
      fechaTexto
        ? `<p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 28px;">📅 El sorteo se realiza el <strong>${fechaTexto}</strong>, en vivo por Instagram <strong>@firehouse.cheer</strong>.</p>`
        : `<p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 28px;">📅 Pronto anunciaremos la fecha del sorteo por Instagram <strong>@firehouse.cheer</strong>.</p>`
    }
    <p style="font-size:13px;line-height:1.6;color:rgba(245,239,232,.5);margin:0;">N° de orden: ${escaparHtml(datos.commerceOrder)}</p>
  `;
  return plantillaBase('Firehouse Cheerleading All Stars', '¡Ya estás participando en el Gran Concurso! 🎉', cuerpo);
}

/**
 * Correo de confirmación de compra de números de la rifa. Mismo criterio
 * "best effort" que el resto: si falla, no debe romper la confirmación del
 * pago, que ya quedó guardada en la base antes de llegar acá.
 */
export async function enviarCorreoConfirmacionRifa(
  apiKey: string,
  remitente: string,
  datos: DatosCorreoRifa,
  bcc?: string[],
): Promise<void> {
  await enviarCorreoGenerico(
    apiKey,
    remitente,
    datos.compradorEmail,
    '¡Ya estás participando en el Gran Concurso Firehouse! 🎉',
    construirHtmlRifa(datos),
    bcc,
  );
}

// ---------------------------------------------------------------------------
// Correo de confirmación de compra — Campaña Firehouse 2026
// ---------------------------------------------------------------------------

export const NOMBRE_PRODUCTO_CAMPANA: Record<string, string> = {
  BLAZE: 'Sobre Blaze',
  NOVA: 'Sobre Nova',
  BLAZE_NOVA: 'Pack Blaze + Nova',
};

export interface DatosCorreoCampana {
  compradorNombre: string;
  compradorEmail: string;
  monto: number;
  commerceOrder: string;
  ordenId: string;
  /** Uno por producto comprado, en el mismo orden que los ítems de la orden. */
  productos: string[];
  /** Uno por producto comprado (fn_confirmar_orden_campana genera un código por ítem). */
  codigos: string[];
  /** URL base del sitio, para armar el link a la página de descarga. */
  siteUrl: string;
}

function construirHtmlCampana(datos: DatosCorreoCampana): string {
  const nombre = escaparHtml(datos.compradorNombre.split(' ')[0]);
  const montoTexto = `$${datos.monto.toLocaleString('es-CL')}`;
  const urlDescarga = `${datos.siteUrl}/campana-2026/descarga?orden=${datos.ordenId}`;

  const listaProductos = datos.productos
    .map((p) => `<li style="margin-bottom:4px;">${escaparHtml(NOMBRE_PRODUCTO_CAMPANA[p] ?? p)}</li>`)
    .join('');

  const listaCodigos = datos.codigos
    .map(
      (c) =>
        `<span style="display:inline-block;background:#171412;color:#FFC400;font-family:monospace;font-size:15px;padding:6px 12px;border-radius:6px;margin:0 6px 6px 0;">${escaparHtml(c)}</span>`,
    )
    .join('');

  const cuerpo = `
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 16px;">
      Hola ${nombre}, ¡gracias por apoyar a Firehouse! 🔥
    </p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 8px;">
      Tu compra incluye:
    </p>
    <ul style="font-size:15px;line-height:1.5;color:#F5EFE8;margin:0 0 20px;padding-left:20px;">
      ${listaProductos}
    </ul>
    <p style="margin:0 0 28px;">
      <a href="${urlDescarga}"
         style="display:inline-block;background:#1B4FA8;color:#ffffff;text-decoration:none;
                padding:13px 28px;border-radius:999px;font-size:14px;font-weight:500;">
        Descargar tu colección
      </a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:rgba(245,239,232,.6);margin:0 0 8px;">
      Además, tu compra incluye una participación en la promoción Firehouse 2026 — este es tu código:
    </p>
    <p style="margin:0 0 24px;">${listaCodigos}</p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 8px;">
      Monto pagado: <strong>${montoTexto}</strong>
    </p>
    <p style="font-size:13px;line-height:1.6;color:rgba(245,239,232,.5);margin:0;">N° de orden: ${escaparHtml(datos.commerceOrder)}</p>
  `;
  return plantillaBase('Firehouse Cheerleading All Stars', '¡Ya tienes tu colección Firehouse 2026! 🎉', cuerpo);
}

/**
 * Correo de confirmación de compra de la Campaña Firehouse 2026. A propósito
 * mantiene el producto (el link de descarga) y la participación (el código)
 * en bloques separados dentro del mismo correo — la separación conceptual
 * que sostiene todo este modelo no se pierde ni siquiera acá.
 *
 * Mismo criterio "best effort" que el resto: si falla, no debe romper la
 * confirmación del pago, que ya quedó guardada en la base antes de llegar acá.
 */
export async function enviarCorreoConfirmacionCampana(
  apiKey: string,
  remitente: string,
  datos: DatosCorreoCampana,
  bcc?: string[],
): Promise<void> {
  await enviarCorreoGenerico(
    apiKey,
    remitente,
    datos.compradorEmail,
    '¡Ya tienes tu colección Firehouse 2026! 🎉',
    construirHtmlCampana(datos),
    bcc,
  );
}

// ---------------------------------------------------------------------------
// Correo de confirmación — participación sin compra, Campaña Firehouse 2026
// ---------------------------------------------------------------------------

export interface DatosCorreoParticipacionGratis {
  nombre: string;
  email: string;
  codigo: string;
}

function construirHtmlParticipacionGratis(datos: DatosCorreoParticipacionGratis): string {
  const nombre = escaparHtml(datos.nombre.split(' ')[0]);
  const cuerpo = `
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 16px;">
      Hola ${nombre}, ¡ya estás participando en la promoción Firehouse 2026! 🔥
    </p>
    <p style="font-size:13px;line-height:1.6;color:rgba(245,239,232,.6);margin:0 0 8px;">
      Tu código de participación:
    </p>
    <p style="margin:0 0 24px;">
      <span style="display:inline-block;background:#171412;color:#FFC400;font-family:monospace;font-size:15px;padding:6px 12px;border-radius:6px;">${escaparHtml(datos.codigo)}</span>
    </p>
    <p style="font-size:13px;line-height:1.6;color:rgba(245,239,232,.6);margin:0;">
      Guarda este correo — este código entra al mismo sorteo que las participaciones de quienes
      compraron un sobre. El sorteo se transmite en vivo por Instagram <strong>@firehouse.cheer</strong>.
    </p>
  `;
  return plantillaBase('Firehouse Cheerleading All Stars', '¡Ya estás participando! 🎉', cuerpo);
}

/** Best effort — si Resend falla, no debe romper el registro, que ya quedó guardado. */
export async function enviarCorreoParticipacionGratisCampana(
  apiKey: string,
  remitente: string,
  datos: DatosCorreoParticipacionGratis,
  bcc?: string[],
): Promise<void> {
  await enviarCorreoGenerico(
    apiKey,
    remitente,
    datos.email,
    '¡Ya estás participando en la promoción Firehouse 2026! 🎉',
    construirHtmlParticipacionGratis(datos),
    bcc,
  );
}
