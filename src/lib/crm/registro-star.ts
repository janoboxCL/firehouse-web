// Validación pura del formulario público /registro-star. Sin dependencias
// de red ni de Supabase — a propósito, para poder testearla con
// `node --test` sin tocar ningún servicio externo. Mismo criterio que
// src/lib/crm/registro.ts: el endpoint server-side (functions/api/
// registro-star/crear-orden.ts) es la única puerta de entrada que debe
// llamar a esto antes de tocar la base de datos o la pasarela de pago.

export const MONTO_KIT_STAR = 10000;
export const MAX_ATLETAS_STAR = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ApoderadoStarValidado {
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string;
  comuna: string;
}

export interface AtletaStarValidado {
  nombre: string;
  apellidos: string;
  fechaNacimiento: string;
}

export interface RegistroStarValidado {
  apoderado: ApoderadoStarValidado;
  atletas: AtletaStarValidado[];
  montoTotal: number;
}

export type ResultadoValidacionStar =
  | { ok: true; datos: RegistroStarValidado }
  | { ok: false; error: string };

export function validarRegistroStar(body: Record<string, unknown>): ResultadoValidacionStar {
  const apoderadoCrudo = (body.apoderado ?? {}) as Record<string, unknown>;
  const atletasCrudos = Array.isArray(body.atletas) ? body.atletas : [];

  const apNombre = String(apoderadoCrudo.nombre ?? '').trim().slice(0, 80);
  const apApellidos = String(apoderadoCrudo.apellidos ?? '').trim().slice(0, 120);
  const apTelefono = String(apoderadoCrudo.telefono ?? '').trim().slice(0, 20);
  const apEmail = String(apoderadoCrudo.email ?? '').trim().slice(0, 254);
  const apComuna = String(apoderadoCrudo.comuna ?? '').trim().slice(0, 100);

  if (!apNombre || apNombre.length < 2) return { ok: false, error: 'nombre_apoderado_invalido' };
  if (!apApellidos || apApellidos.length < 2) return { ok: false, error: 'apellidos_apoderado_invalidos' };
  if (!EMAIL_RE.test(apEmail)) return { ok: false, error: 'email_invalido' };
  if (apTelefono.replace(/\D/g, '').length < 8) return { ok: false, error: 'telefono_invalido' };
  if (!apComuna) return { ok: false, error: 'comuna_invalida' };
  if (atletasCrudos.length === 0 || atletasCrudos.length > MAX_ATLETAS_STAR) {
    return { ok: false, error: 'cantidad_atletas_invalida' };
  }

  const atletas: AtletaStarValidado[] = [];
  for (const raw of atletasCrudos) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const atNombre = String(a.nombre ?? '').trim().slice(0, 80);
    const atApellidos = String(a.apellidos ?? '').trim().slice(0, 120);
    const atFechaNacimiento = String(a.fechaNacimiento ?? '').trim();

    if (!atNombre || atNombre.length < 2) return { ok: false, error: 'nombre_atleta_invalido' };
    if (!atFechaNacimiento || isNaN(Date.parse(atFechaNacimiento))) return { ok: false, error: 'fecha_nacimiento_invalida' };
    if (new Date(atFechaNacimiento) > new Date()) return { ok: false, error: 'fecha_nacimiento_futura' };

    atletas.push({ nombre: atNombre, apellidos: atApellidos || apApellidos, fechaNacimiento: atFechaNacimiento });
  }

  if (body.aceptaCondiciones !== true) return { ok: false, error: 'debe_aceptar_condiciones' };

  return {
    ok: true,
    datos: {
      apoderado: { nombre: apNombre, apellidos: apApellidos, telefono: apTelefono, email: apEmail, comuna: apComuna },
      atletas,
      montoTotal: MONTO_KIT_STAR * atletas.length,
    },
  };
}
