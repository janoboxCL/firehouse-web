// Lógica de cliente para /campana-2026/participar (participación sin compra).
//
// El RUT se valida acá para dar feedback inmediato, pero la validación real
// —la que importa— vuelve a correr en el servidor antes de tocar la base de
// datos (ver functions/lib/rut.ts). Nunca hay que confiar sólo en esto.

function $<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function limpiarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

function calcularDv(cuerpo: string): string {
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function rutValido(rutCrudo: string): boolean {
  const limpio = limpiarRut(rutCrudo);
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  return calcularDv(cuerpo) === dv;
}

function formatearRutInput(input: HTMLInputElement | null): void {
  if (!input) return;
  input.addEventListener('input', () => {
    const limpio = limpiarRut(input.value).slice(0, 9);
    const cuerpo = limpio.slice(0, -1);
    const dv = limpio.slice(-1);
    const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = cuerpo ? `${cuerpoConPuntos}-${dv}` : limpio;
  });
}

function formatearTelefonoInput(input: HTMLInputElement | null): void {
  if (!input) return;
  input.addEventListener('input', () => {
    const digitos = input.value.replace(/\D/g, '').slice(0, 9);
    if (digitos.length <= 1) { input.value = digitos; return; }
    const resto = digitos.slice(1);
    input.value = resto.length > 4 ? `${digitos[0]} ${resto.slice(0, 4)} ${resto.slice(4)}` : `${digitos[0]} ${resto}`;
  });
}

function mostrarBloque(id: string): void {
  ['pgForm', 'pgExito', 'pgYaParticipa'].forEach((otro) => $<HTMLElement>(`#${otro}`)?.setAttribute('hidden', ''));
  $<HTMLElement>(`#${id}`)?.removeAttribute('hidden');
}

export function iniciarParticiparGratis(): void {
  const form = $<HTMLFormElement>('#pgFormulario');
  const nombreInput = $<HTMLInputElement>('#pgNombre');
  const rutInput = $<HTMLInputElement>('#pgRut');
  const emailInput = $<HTMLInputElement>('#pgEmail');
  const telefonoInput = $<HTMLInputElement>('#pgTelefono');
  const aceptaInput = $<HTMLInputElement>('#pgAcepta');
  const formError = $<HTMLElement>('#pgFormError');
  const enviarBtn = $<HTMLButtonElement>('#pgEnviar');
  const codigoEl = $<HTMLElement>('#pgCodigo');

  formatearRutInput(rutInput);
  formatearTelefonoInput(telefonoInput);

  form?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const nombre = nombreInput?.value.trim() ?? '';
    const rut = rutInput?.value.trim() ?? '';
    const email = emailInput?.value.trim() ?? '';
    const telefono = telefonoInput?.value.trim() ?? '';
    const telefonoDigitos = telefono.replace(/\D/g, '');
    const acepta = aceptaInput?.checked ?? false;

    if (
      nombre.length < 3 ||
      !rutValido(rut) ||
      !EMAIL_RE.test(email) ||
      telefonoDigitos.length < 8 ||
      !acepta
    ) {
      if (formError) {
        formError.textContent = !acepta
          ? 'Debes aceptar las bases de la promoción para continuar.'
          : 'Revisa que el nombre, RUT, correo y celular estén completos y con un formato válido.';
        formError.removeAttribute('hidden');
      }
      return;
    }
    formError?.setAttribute('hidden', '');

    if (enviarBtn) { enviarBtn.disabled = true; enviarBtn.textContent = 'Enviando…'; }

    try {
      const res = await fetch('/api/campana-2026/participar-gratis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nombre, rut, email, telefono: `+56${telefonoDigitos}`, aceptaBases: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { codigo?: string; error?: string };

      if (res.ok) {
        if (codigoEl && data.codigo) codigoEl.textContent = data.codigo;
        mostrarBloque('pgExito');
        return;
      }

      if (res.status === 409 && data.error === 'rut_ya_participa') {
        mostrarBloque('pgYaParticipa');
        return;
      }

      if (formError) {
        formError.textContent = 'No pudimos registrar tu participación. Revisa tus datos e inténtalo de nuevo.';
        formError.removeAttribute('hidden');
      }
    } catch {
      if (formError) {
        formError.textContent = 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
        formError.removeAttribute('hidden');
      }
    } finally {
      if (enviarBtn) { enviarBtn.disabled = false; enviarBtn.textContent = 'Participar sin compra'; }
    }
  });
}
