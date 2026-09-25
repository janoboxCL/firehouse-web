// Versión correo de las plantillas de mensajes. Lógica pura (sin DOM), usada
// por el panel para la vista previa y para armar el HTML que se envía.
//
// El texto del correo se escribe con un formato mínimo, pensado para editarse
// desde el panel sin saber HTML:
//
//   - Párrafos separados por una línea en blanco.
//   - Líneas que empiezan con "- " forman una lista.
//   - [[clase]]                  → tarjeta con fecha, horario y lugar de la clase.
//   - [[boton: Texto | https://…]] → botón amarillo (el link puede ser {link_pago}).
//
// El formato se interpreta ANTES de reemplazar las variables, así un dato
// ingresado por una familia nunca puede convertirse en un botón o un link, y
// todo lo que llega al HTML se escapa.

import { completarPlantilla, type DatosPlantillaMensaje, type VariablePlantilla } from './plantillas.ts';

export const SITIO_FIREHOUSE = 'https://firehousecheer.cl';
export const DIRECCION_FIREHOUSE = 'Santa Corina 197, La Cisterna';
export const REFERENCIA_DIRECCION = 'a pasos del Metro Lo Ovalle';
export const MAPA_FIREHOUSE = 'https://maps.google.com/?q=Santa+Corina+197,+La+Cisterna';
export const WHATSAPP_FIREHOUSE = 'https://wa.me/56986114663';
export const WHATSAPP_TEXTO = '+56 9 8611 4663';

/** Tamaño máximo que acepta /api/admin/enviar-correo. */
export const MAX_HTML_CORREO = 20_000;

type Bloque =
  | { tipo: 'parrafo'; lineas: string[] }
  | { tipo: 'lista'; items: string[] }
  | { tipo: 'clase' }
  | { tipo: 'boton'; texto: string; url: string };

const RE_BOTON = /^\[\[\s*boton\s*:\s*(.+?)\s*\|\s*(.+?)\s*\]\]$/i;
const RE_CLASE = /^\[\[\s*clase\s*\]\]$/i;

/** Divide el texto del correo en bloques (sin reemplazar variables). */
export function interpretarFormato(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  const grupos = texto.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const grupo of grupos) {
    const lineas = grupo.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    let parrafo: string[] = [];
    let lista: string[] = [];
    const cerrarParrafo = () => {
      if (parrafo.length) bloques.push({ tipo: 'parrafo', lineas: parrafo });
      parrafo = [];
    };
    const cerrarLista = () => {
      if (lista.length) bloques.push({ tipo: 'lista', items: lista });
      lista = [];
    };
    for (const linea of lineas) {
      const boton = RE_BOTON.exec(linea);
      if (RE_CLASE.test(linea) || boton) {
        cerrarParrafo();
        cerrarLista();
        bloques.push(boton ? { tipo: 'boton', texto: boton[1], url: boton[2] } : { tipo: 'clase' });
      } else if (/^[-•]\s+/.test(linea)) {
        cerrarParrafo();
        lista.push(linea.replace(/^[-•]\s+/, ''));
      } else {
        cerrarLista();
        parrafo.push(linea);
      }
    }
    cerrarParrafo();
    cerrarLista();
  }
  return bloques;
}

export function escaparCorreo(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function esUrlSegura(url: string): boolean {
  return /^https:\/\/[^\s"'<>]+$/i.test(url);
}

/** Escapa y convierte en link las URL https que aparezcan en el texto. */
function textoConLinks(texto: string): string {
  return escaparCorreo(texto).replace(
    /https:\/\/[^\s<]+[^\s<.,;:!?)]/g,
    (url) => `<a href="${url}" style="color:#FFC400;word-break:break-all;">${url}</a>`,
  );
}

export interface ClaseCorreo {
  /** "Primera clase", "Clase de prueba"… */
  etiqueta: string;
  /** Hora de término, ej.: "20:00". La de inicio es {hora_clase}. */
  horaFin?: string | null;
}

export interface OpcionesCorreo {
  asunto: string;
  cuerpo: string;
  datos: DatosPlantillaMensaje;
  clase?: ClaseCorreo;
  /** Origen para las imágenes (en la vista previa, el del panel). */
  sitio?: string;
}

export interface CorreoRenderizado {
  asunto: string;
  html: string;
  /** Versión solo texto, para los programas de correo que no muestran HTML. */
  texto: string;
  faltantes: VariablePlantilla[];
}

/** "el sábado 3 de octubre" → "Sábado 3 de octubre". */
function fechaTitulo(fecha: string): string {
  const sinArticulo = fecha.replace(/^el\s+/i, '');
  return sinArticulo.charAt(0).toUpperCase() + sinArticulo.slice(1);
}

function tarjetaClase(datos: DatosPlantillaMensaje, clase: ClaseCorreo): { html: string; texto: string } {
  const fecha = fechaTitulo(String(datos.fecha_clase ?? ''));
  const horario = clase.horaFin ? `${datos.hora_clase} a ${clase.horaFin} h` : `${datos.hora_clase} h`;
  const fila = (icono: string, contenido: string) =>
    `<tr><td style="width:30px;padding:6px 0;vertical-align:top;font-size:17px;">${icono}</td><td style="padding:6px 0;font-size:15px;line-height:1.5;color:#F5EFE8;">${contenido}</td></tr>`;
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;background:#171412;border-radius:14px;border-left:4px solid #FFC400;">
  <tr><td style="padding:18px 20px;">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#FFC400;font-weight:bold;">${escaparCorreo(clase.etiqueta)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0">
      ${fila('📅', `<strong style="color:#ffffff;">${escaparCorreo(fecha)}</strong>`)}
      ${fila('⏰', escaparCorreo(horario))}
      ${fila('📍', `${escaparCorreo(DIRECCION_FIREHOUSE)}<br><span style="color:rgba(245,239,232,.65);font-size:13px;">${escaparCorreo(REFERENCIA_DIRECCION)} · <a href="${MAPA_FIREHOUSE}" style="color:#FFC400;">Ver en el mapa</a></span>`)}
    </table>
  </td></tr>
</table>`;
  const texto = `${clase.etiqueta.toUpperCase()}\n${fecha}\n${horario}\n${DIRECCION_FIREHOUSE} (${REFERENCIA_DIRECCION})\n${MAPA_FIREHOUSE}`;
  return { html, texto };
}

function boton(texto: string, url: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;">
  <tr><td style="background:#FFC400;border-radius:999px;">
    <a href="${url}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:bold;color:#171412;text-decoration:none;border-radius:999px;">${escaparCorreo(texto)}</a>
  </td></tr>
</table>`;
}

/**
 * Arma el correo completo. Si falta alguna variable, `faltantes` la informa
 * (el panel no deja enviar), pero igual devuelve el HTML para la vista previa.
 */
export function renderizarCorreo(op: OpcionesCorreo): CorreoRenderizado {
  const faltantes = new Set<VariablePlantilla>();
  const completar = (t: string) => {
    const r = completarPlantilla(t, op.datos);
    r.faltantes.forEach((f) => faltantes.add(f));
    return r.texto;
  };

  const asunto = completar(op.asunto).replace(/\s+/g, ' ').trim();
  const bloques = interpretarFormato(op.cuerpo);
  const partesHtml: string[] = [];
  const partesTexto: string[] = [];
  let preheader = '';
  let primero = true;

  for (const b of bloques) {
    if (b.tipo === 'parrafo') {
      const lineas = b.lineas.map(completar);
      if (primero && lineas.length === 1 && lineas[0].length <= 60) {
        partesHtml.push(`<p style="margin:0 0 18px;font-size:20px;line-height:1.35;font-weight:bold;color:#ffffff;">${textoConLinks(lineas[0])}</p>`);
      } else {
        if (!preheader) preheader = lineas.join(' ');
        partesHtml.push(`<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#F5EFE8;">${lineas.map(textoConLinks).join('<br>')}</p>`);
      }
      partesTexto.push(lineas.join('\n'));
    } else if (b.tipo === 'lista') {
      const items = b.items.map(completar);
      partesHtml.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:-6px 0 20px;">${items
          .map(
            (i) =>
              `<tr><td style="width:22px;padding:4px 0;vertical-align:top;color:#FFC400;font-size:16px;line-height:1.5;">★</td><td style="padding:4px 0;font-size:16px;line-height:1.5;color:#F5EFE8;">${textoConLinks(i)}</td></tr>`,
          )
          .join('')}</table>`,
      );
      partesTexto.push(items.map((i) => `- ${i}`).join('\n'));
    } else if (b.tipo === 'clase') {
      if (!op.clase) continue;
      if (!op.datos.fecha_clase) faltantes.add('fecha_clase');
      if (!op.datos.hora_clase) faltantes.add('hora_clase');
      const t = tarjetaClase(op.datos, op.clase);
      partesHtml.push(t.html);
      partesTexto.push(t.texto);
    } else {
      const texto = completar(b.texto);
      const url = completar(b.url);
      if (esUrlSegura(url)) {
        partesHtml.push(boton(texto, url));
        partesTexto.push(`${texto}: ${url}`);
      } else if (url.includes('{')) {
        // Falta el dato (ej.: el link de pago aún no se genera): se muestra en la
        // vista previa y `faltantes` impide el envío.
        partesHtml.push(boton(texto, '#'));
      } else {
        // Un link mal escrito no se envía como botón; queda como texto visible.
        partesHtml.push(`<p style="margin:0 0 18px;font-size:16px;color:#F5EFE8;">${escaparCorreo(`${texto}: ${url}`)}</p>`);
        partesTexto.push(`${texto}: ${url}`);
      }
    }
    primero = false;
  }

  const sitio = (op.sitio ?? SITIO_FIREHOUSE).replace(/\/$/, '');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escaparCorreo(asunto)}</title></head>
<body style="margin:0;padding:0;background:#171412;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escaparCorreo(preheader.slice(0, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#171412;">
<tr><td align="center" style="padding:28px 14px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td align="center" style="padding:0 0 18px;">
      <img src="${sitio}/media/correo/star-logo.png" width="170" height="115" alt="Firehouse Star" style="display:block;border:0;width:170px;height:auto;">
    </td></tr>
    <tr><td style="background:#201D1B;border-radius:18px;border-top:4px solid #FFC400;padding:32px 28px 12px;">
      ${partesHtml.join('\n      ')}
    </td></tr>
    <tr><td style="padding:22px 8px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:84px;vertical-align:bottom;"><img src="${sitio}/media/correo/sparky-saludo.png" width="72" height="107" alt="Sparky" style="display:block;border:0;width:72px;height:auto;"></td>
        <td style="vertical-align:middle;padding-left:12px;font-size:13px;line-height:1.6;color:rgba(245,239,232,.7);">
          <strong style="color:#FFC400;">Firehouse Cheerleading All Stars</strong><br>
          ${escaparCorreo(DIRECCION_FIREHOUSE)} · ${escaparCorreo(REFERENCIA_DIRECCION)}<br>
          WhatsApp <a href="${WHATSAPP_FIREHOUSE}" style="color:#FFC400;">${WHATSAPP_TEXTO}</a> · <a href="${SITIO_FIREHOUSE}" style="color:#FFC400;">firehousecheer.cl</a>
        </td>
      </tr></table>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const texto = `${partesTexto.join('\n\n')}\n\n--\nFirehouse Cheerleading All Stars\n${DIRECCION_FIREHOUSE}\nWhatsApp ${WHATSAPP_TEXTO}`;
  return { asunto, html, texto, faltantes: [...faltantes] };
}
