// Envío del correo de confirmación vía Resend (https://resend.com).
// Este envío es "best effort": si falla, NUNCA debe hacer fallar el registro,
// que ya quedó guardado correctamente en la base de datos antes de llegar acá.

export interface DatosCorreoConfirmacion {
  apoderadoNombre: string;
  apoderadoEmail: string;
  nombresAtletas: string[];
}

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

function construirHtml(datos: DatosCorreoConfirmacion): string {
  const nombres = escaparHtml(textoAtletas(datos.nombresAtletas));
  const nombreApoderado = escaparHtml(datos.apoderadoNombre.split(' ')[0]);

  return `<!doctype html>
<html lang="es-CL">
<body style="margin:0;padding:32px 16px;background:#171412;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#201D1B;border-radius:16px;padding:36px 32px;color:#F5EFE8;">
    <p style="font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#FFC400;margin:0 0 18px;font-weight:bold;">
      Firehouse Cheerleading All Stars
    </p>
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px;color:#F5EFE8;">¡Recibimos tu registro! 🔥</h1>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 16px;">
      Hola ${nombreApoderado}, gracias por registrar a <strong>${nombres}</strong> en Firehouse.
    </p>
    <p style="font-size:15px;line-height:1.65;color:rgba(245,239,232,.86);margin:0 0 28px;">
      Revisaremos la información y nos comunicaremos contigo pronto para orientarte sobre la
      alternativa más adecuada para tu familia: Pretemporada, la temporada 2027, o lo que mejor
      les acomode.
    </p>
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

/** Llamada cruda a la API de Resend. La usan tanto el correo de confirmación
 * automático como el envío manual desde el panel admin. */
export async function enviarCorreoGenerico(
  apiKey: string,
  remitente: string,
  destinatario: string,
  asunto: string,
  html: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: remitente, to: destinatario, subject: asunto, html }),
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
): Promise<void> {
  await enviarCorreoGenerico(
    apiKey,
    remitente,
    datos.apoderadoEmail,
    '¡Recibimos tu registro en Firehouse! 🔥',
    construirHtml(datos),
  );
}
