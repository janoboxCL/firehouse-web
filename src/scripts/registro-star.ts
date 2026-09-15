// Formulario corto de Firehouse Star. A diferencia de /registro (3 pasos,
// para triage entre varios journeys), acá el journey ya se sabe de
// antemano — este script sólo valida, llama a crear-orden y redirige al
// checkout de la pasarela. Mismo patrón de fetch/redirect que
// src/scripts/campana2026.ts.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function $<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

export function iniciarFormularioStar(): void {
  const form = $<HTMLFormElement>('#rstar-form');
  const btn = $<HTMLButtonElement>('#rstar-enviar');
  const error = $<HTMLParagraphElement>('#rstar-error');
  const deshabilitadoAviso = $<HTMLDivElement>('#rstar-deshabilitado');
  if (!form || !btn) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error?.setAttribute('hidden', '');
    deshabilitadoAviso?.setAttribute('hidden', '');

    // Honeypot — igual que el resto de los formularios públicos del sitio.
    const trampa = $<HTMLInputElement>('#rstar-trampa');
    if (trampa && trampa.value.trim() !== '') return;

    const apNombre = $<HTMLInputElement>('#rstar-ap-nombre')?.value.trim() ?? '';
    const apApellidos = $<HTMLInputElement>('#rstar-ap-apellidos')?.value.trim() ?? '';
    const apTelefono = $<HTMLInputElement>('#rstar-ap-telefono')?.value.trim() ?? '';
    const apEmail = $<HTMLInputElement>('#rstar-ap-email')?.value.trim() ?? '';
    const apComuna = $<HTMLInputElement>('#rstar-ap-comuna')?.value.trim() ?? '';

    const atNombre = $<HTMLInputElement>('#rstar-at-nombre')?.value.trim() ?? '';
    const atApellidos = $<HTMLInputElement>('#rstar-at-apellidos')?.value.trim() ?? '';
    const atFecha = $<HTMLInputElement>('#rstar-at-fecha')?.value.trim() ?? '';

    const aceptaCondiciones = $<HTMLInputElement>('#rstar-acepta')?.checked ?? false;

    const telefonoDigitos = apTelefono.replace(/\D/g, '');

    const mostrarError = (msg: string) => {
      if (error) {
        error.textContent = msg;
        error.removeAttribute('hidden');
      }
    };

    if (apNombre.length < 2 || apApellidos.length < 2) return mostrarError('Ingresa el nombre y apellido del apoderado.');
    if (!EMAIL_RE.test(apEmail)) return mostrarError('Ingresa un correo válido.');
    if (telefonoDigitos.length < 8) return mostrarError('Ingresa un WhatsApp válido.');
    if (!apComuna) return mostrarError('Ingresa la comuna.');
    if (atNombre.length < 2) return mostrarError('Ingresa el nombre de la niña o el niño.');
    if (!atFecha) return mostrarError('Ingresa la fecha de nacimiento.');
    if (!aceptaCondiciones) return mostrarError('Debes aceptar las condiciones para continuar.');

    btn.disabled = true;
    const textoOriginal = btn.textContent;
    btn.textContent = 'Procesando…';

    try {
      const res = await fetch('/api/registro-star/crear-orden', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apoderado: {
            nombre: apNombre,
            apellidos: apApellidos,
            telefono: telefonoDigitos.startsWith('56') ? `+${telefonoDigitos}` : `+56${telefonoDigitos}`,
            email: apEmail,
            comuna: apComuna,
          },
          atleta: {
            nombre: atNombre,
            apellidos: atApellidos || apApellidos,
            fechaNacimiento: atFecha,
          },
          aceptaCondiciones: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.error === 'checkout_deshabilitado') {
        deshabilitadoAviso?.removeAttribute('hidden');
        btn.disabled = false;
        btn.textContent = textoOriginal;
        return;
      }

      mostrarError('No pudimos procesar tu inscripción. Intenta de nuevo o escríbenos por WhatsApp.');
      btn.disabled = false;
      btn.textContent = textoOriginal;
    } catch {
      mostrarError('No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
}
