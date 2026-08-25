-- Firehouse CRM MVP — migración inicial
-- Crea el modelo completo: apoderados, atletas, casos_crm, interacciones,
-- admin_profiles, control de idempotencia de envíos, RLS y funciones RPC.
--
-- Cómo aplicar: Supabase Dashboard → SQL Editor → pegar y ejecutar,
-- o `supabase db push` si usas el CLI de Supabase localmente.

create extension if not exists pgcrypto;

-- ============================================================================
-- FUNCIÓN DE SOPORTE: updated_at automático
-- ============================================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- TABLA: admin_profiles
-- Perfil de usuarios administrativos de Firehouse. Se crea automáticamente
-- vacío/inactivo cuando un usuario se registra en Supabase Auth; un ADMIN
-- existente debe activarlo con un rol desde el propio panel o SQL editor.
-- ============================================================================
create table admin_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(100),
  role         varchar(30) not null default 'GESTOR' check (role in ('ADMIN', 'GESTOR')),
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Helper: ¿el usuario autenticado actual es un admin activo?
-- SECURITY DEFINER para poder leer admin_profiles sin depender de sus propias policies
-- (evita recursión de RLS) — sólo devuelve un booleano, no expone datos.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admin_profiles
    where user_id = auth.uid() and active = true
  );
$$;

-- Un usuario recién creado en Supabase Auth obtiene automáticamente una fila
-- admin_profiles inactiva; así nunca hay usuarios "sueltos" sin perfil.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into admin_profiles (user_id, display_name, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email), false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ============================================================================
-- TABLA: apoderados
-- ============================================================================
create table apoderados (
  id                    uuid primary key default gen_random_uuid(),
  nombre                varchar(80) not null,
  apellidos             varchar(120) not null,
  telefono              varchar(20) not null,
  email                 varchar(254) not null,
  relacion              varchar(30) not null check (relacion in ('MAMA','PAPA','TUTOR','OTRO')),
  comuna                varchar(100) not null,
  telefono_secundario   varchar(20),
  canal_preferido       varchar(30) not null check (canal_preferido in ('WHATSAPP','EMAIL','CUALQUIERA')),

  consent_contact       boolean not null,
  consent_at            timestamptz not null,
  privacy_policy_version varchar(30),

  possible_duplicate    boolean not null default false,
  duplicate_reason      text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_apoderados_telefono   on apoderados (telefono);
create index idx_apoderados_email      on apoderados (email);
create index idx_apoderados_created_at on apoderados (created_at);

create trigger trg_apoderados_updated_at
  before update on apoderados
  for each row execute function set_updated_at();

-- ============================================================================
-- TABLA: atletas
-- ============================================================================
create table atletas (
  id                    uuid primary key default gen_random_uuid(),
  apoderado_id          uuid not null references apoderados(id) on delete cascade,

  nombre                varchar(80) not null,
  apellidos             varchar(120) not null,
  fecha_nacimiento      date not null,

  firehouse_actual      boolean not null,
  tiene_experiencia     boolean,

  anos_experiencia      varchar(20),
  academia_anterior     varchar(120),

  fuera_rango_habitual  boolean not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint chk_fecha_nacimiento_no_futura check (fecha_nacimiento <= current_date)
);

create index idx_atletas_apoderado_id on atletas (apoderado_id);

create trigger trg_atletas_updated_at
  before update on atletas
  for each row execute function set_updated_at();

-- ============================================================================
-- TABLA: casos_crm
-- ============================================================================
create table casos_crm (
  id                    uuid primary key default gen_random_uuid(),
  atleta_id             uuid not null references atletas(id) on delete cascade,

  journey               varchar(40) not null check (journey in (
                           'RENOVACION_2027','PRETEMPORADA','EXPERIMENTADA_2027',
                           'PRINCIPIANTE_2027','POR_CLASIFICAR'
                         )),
  estado                varchar(40) not null default 'NUEVO' check (estado in (
                           'NUEVO','CONTACTADO','SEGUIMIENTO','AGENDADO','ASISTIO',
                           'INSCRITO','NO_RESPONDE','CONTACTAR_MAS_ADELANTE',
                           'NO_CONTINUA','NO_INTERESADO'
                         )),

  intencion_inicial     varchar(30) check (intencion_inicial in ('CONTINUAR','INDECISO') or intencion_inicial is null),

  origen                varchar(40) not null default 'WEB_REGISTRO',
  como_conocio          varchar(50) not null,

  comentario_inicial    varchar(500),

  responsable_id        uuid references admin_profiles(user_id),
  proxima_accion        varchar(255),
  fecha_proxima_accion  timestamptz,

  prioridad             varchar(20) not null default 'NORMAL' check (prioridad in ('NORMAL','ALTA')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_casos_journey  on casos_crm (journey);
create index idx_casos_estado   on casos_crm (estado);
create index idx_casos_fecha_proxima_accion on casos_crm (fecha_proxima_accion);
create index idx_casos_responsable on casos_crm (responsable_id);
create index idx_casos_created_at on casos_crm (created_at);
create index idx_casos_atleta_id on casos_crm (atleta_id);

create trigger trg_casos_updated_at
  before update on casos_crm
  for each row execute function set_updated_at();

-- Estados de cierre no requieren próxima acción: al entrar a un estado cerrado
-- limpiamos automáticamente proxima_accion / fecha_proxima_accion.
create or replace function limpiar_seguimiento_si_cerrado()
returns trigger
language plpgsql
as $$
begin
  if new.estado in ('INSCRITO','NO_CONTINUA','NO_INTERESADO')
     and (old.estado is distinct from new.estado) then
    new.proxima_accion := null;
    new.fecha_proxima_accion := null;
  end if;
  return new;
end;
$$;

create trigger trg_casos_limpiar_cierre
  before update on casos_crm
  for each row execute function limpiar_seguimiento_si_cerrado();

-- ============================================================================
-- TABLA: interacciones
-- ============================================================================
create table interacciones (
  id             uuid primary key default gen_random_uuid(),
  caso_id        uuid not null references casos_crm(id) on delete cascade,

  tipo           varchar(30) not null check (tipo in ('WHATSAPP','LLAMADA','EMAIL','NOTA','CAMBIO_ESTADO')),
  nota           text,

  responsable_id uuid references admin_profiles(user_id),
  fecha          timestamptz not null default now(),

  created_at     timestamptz not null default now()
);

create index idx_interacciones_caso_id on interacciones (caso_id);
create index idx_interacciones_fecha   on interacciones (fecha);

-- Cada cambio de estado de un caso queda registrado automáticamente como interacción,
-- sin importar si el UPDATE vino del panel admin o de una función RPC.
create or replace function registrar_cambio_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado is distinct from new.estado then
    insert into interacciones (caso_id, tipo, nota, responsable_id, fecha)
    values (
      new.id,
      'CAMBIO_ESTADO',
      format('Estado cambiado de %s a %s', old.estado, new.estado),
      auth.uid(),
      now()
    );
  end if;
  return new;
end;
$$;

create trigger trg_casos_log_cambio_estado
  after update on casos_crm
  for each row execute function registrar_cambio_estado();

-- ============================================================================
-- TABLA: registro_submissions
-- Control de idempotencia del formulario público: un mismo submissionId
-- (UUID generado en el navegador) nunca genera dos registros aunque el
-- request se reintente por timeout, doble clic o refresh.
-- ============================================================================
create table registro_submissions (
  submission_id uuid primary key,
  apoderado_id  uuid not null references apoderados(id),
  resultado     jsonb not null,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- RLS: todas las tablas de negocio quedan cerradas por defecto.
-- anon no tiene ninguna policy (⇒ ningún acceso). authenticated sólo accede
-- si is_admin() es verdadero. El formulario público inserta exclusivamente
-- vía la función fn_crear_registro con service_role (que además bypassea RLS).
-- ============================================================================
alter table apoderados            enable row level security;
alter table atletas               enable row level security;
alter table casos_crm             enable row level security;
alter table interacciones         enable row level security;
alter table admin_profiles        enable row level security;
alter table registro_submissions  enable row level security;

create policy admin_select_apoderados on apoderados
  for select to authenticated using (is_admin());
create policy admin_update_apoderados on apoderados
  for update to authenticated using (is_admin()) with check (is_admin());

create policy admin_select_atletas on atletas
  for select to authenticated using (is_admin());
create policy admin_update_atletas on atletas
  for update to authenticated using (is_admin()) with check (is_admin());

create policy admin_select_casos on casos_crm
  for select to authenticated using (is_admin());
create policy admin_update_casos on casos_crm
  for update to authenticated using (is_admin()) with check (is_admin());

create policy admin_select_interacciones on interacciones
  for select to authenticated using (is_admin());
create policy admin_insert_interacciones on interacciones
  for insert to authenticated with check (is_admin());

-- Cualquier admin activo puede ver la lista de admins (para el selector de
-- "Responsable"); sólo puede actualizar su propia fila (nombre para mostrar).
create policy admin_select_admin_profiles on admin_profiles
  for select to authenticated using (is_admin());
create policy admin_update_own_profile on admin_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- registro_submissions es de uso exclusivo del backend (service_role); ningún
-- rol de navegador tiene policies acá, ni siquiera de lectura.

-- ============================================================================
-- RPC: fn_crear_registro
-- Único punto de entrada para crear un registro desde el formulario público.
-- SECURITY DEFINER + permisos restringidos a service_role: el endpoint server-side
-- (Cloudflare Pages Function) es el único llamador posible, nunca el navegador.
-- Todo el bloque corre en una sola transacción implícita de PL/pgSQL: si algo
-- falla, no queda un apoderado o atleta huérfano.
-- ============================================================================
create or replace function fn_crear_registro(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_id uuid := (payload->>'submissionId')::uuid;
  v_existente     jsonb;
  v_apoderado     jsonb := payload->'apoderado';
  v_apoderado_id  uuid;
  v_match_phone   boolean;
  v_match_email   boolean;
  v_dup           boolean;
  v_dup_reason    text;
  v_atleta        jsonb;
  v_atleta_id     uuid;
  v_caso_id       uuid;
  v_resultado_atletas jsonb := '[]'::jsonb;
  v_resultado     jsonb;
begin
  -- Idempotencia: si este submissionId ya fue procesado, devolvemos el mismo resultado.
  select resultado into v_existente
  from registro_submissions
  where submission_id = v_submission_id;

  if v_existente is not null then
    return v_existente;
  end if;

  -- Deduplicación (sin fusionar, sin bloquear): sólo se marca.
  select exists(select 1 from apoderados where telefono = v_apoderado->>'telefono') into v_match_phone;
  select exists(select 1 from apoderados where email = v_apoderado->>'email') into v_match_email;

  v_dup := v_match_phone or v_match_email;
  v_dup_reason := case
    when v_match_phone and v_match_email then 'PHONE_AND_EMAIL_MATCH'
    when v_match_phone then 'PHONE_MATCH'
    when v_match_email then 'EMAIL_MATCH'
    else null
  end;

  insert into apoderados (
    nombre, apellidos, telefono, email, relacion, comuna, telefono_secundario,
    canal_preferido, consent_contact, consent_at, privacy_policy_version,
    possible_duplicate, duplicate_reason
  ) values (
    v_apoderado->>'nombre',
    v_apoderado->>'apellidos',
    v_apoderado->>'telefono',
    v_apoderado->>'email',
    v_apoderado->>'relacion',
    v_apoderado->>'comuna',
    nullif(v_apoderado->>'telefonoSecundario', ''),
    v_apoderado->>'canalPreferido',
    true,
    now(),
    v_apoderado->>'privacyPolicyVersion',
    v_dup,
    v_dup_reason
  ) returning id into v_apoderado_id;

  for v_atleta in select * from jsonb_array_elements(payload->'atletas')
  loop
    insert into atletas (
      apoderado_id, nombre, apellidos, fecha_nacimiento,
      firehouse_actual, tiene_experiencia, anos_experiencia, academia_anterior,
      fuera_rango_habitual
    ) values (
      v_apoderado_id,
      v_atleta->>'nombre',
      v_atleta->>'apellidos',
      (v_atleta->>'fechaNacimiento')::date,
      (v_atleta->>'firehouseActual')::boolean,
      (v_atleta->>'tieneExperiencia')::boolean,
      nullif(v_atleta->>'aniosExperiencia', ''),
      nullif(v_atleta->>'academiaAnterior', ''),
      (v_atleta->>'fueraRangoHabitual')::boolean
    ) returning id into v_atleta_id;

    insert into casos_crm (
      atleta_id, journey, estado, intencion_inicial, origen, como_conocio,
      comentario_inicial, proxima_accion, fecha_proxima_accion, prioridad
    ) values (
      v_atleta_id,
      v_atleta->>'journey',
      'NUEVO',
      nullif(v_atleta->>'intencionInicial', ''),
      'WEB_REGISTRO',
      v_apoderado->>'comoConocio',
      nullif(v_apoderado->>'comentarioInicial', ''),
      'Contactar apoderado',
      now(),
      'NORMAL'
    ) returning id into v_caso_id;

    insert into interacciones (caso_id, tipo, nota, fecha)
    values (v_caso_id, 'NOTA', 'Registro recibido desde formulario web', now());

    v_resultado_atletas := v_resultado_atletas || jsonb_build_object(
      'atletaId', v_atleta_id,
      'casoId', v_caso_id,
      'nombre', v_atleta->>'nombre'
    );
  end loop;

  v_resultado := jsonb_build_object(
    'apoderadoId', v_apoderado_id,
    'possibleDuplicate', v_dup,
    'atletas', v_resultado_atletas
  );

  insert into registro_submissions (submission_id, apoderado_id, resultado)
  values (v_submission_id, v_apoderado_id, v_resultado);

  return v_resultado;
end;
$$;

revoke all on function fn_crear_registro(jsonb) from public, anon, authenticated;
grant execute on function fn_crear_registro(jsonb) to service_role;
