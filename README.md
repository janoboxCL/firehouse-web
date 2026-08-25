# Firehouse Cheer — sitio web

Sitio público de Firehouse Cheerleading All Stars, construido en [Astro](https://astro.build)
y desplegado como sitio estático en Cloudflare Pages.

```
npm install
npm run dev      # http://localhost:4321
npm run build    # genera dist/
```

---

# Firehouse CRM

Módulo de registro público (`/registro`) y panel administrativo (`/admin`) para el
seguimiento comercial de familias interesadas en Firehouse. Ver el documento original
de requerimientos para el detalle de negocio; este apartado cubre cómo instalarlo,
configurarlo y operarlo.

## Arquitectura

El sitio sigue siendo **100% estático** (Astro, `build.format: 'file'`, sin adapter SSR).
El CRM se agrega de forma aditiva, sin tocar esa arquitectura:

- **`/registro`** — página Astro + TypeScript vanilla (sin framework nuevo). Envía el
  formulario por `fetch` a una Cloudflare Pages Function.
- **`functions/api/registro.ts`** — [Cloudflare Pages Function](https://developers.cloudflare.com/pages/functions/).
  Único punto de escritura del formulario público: valida todo server-side y llama a la
  base de datos con la *service role key* (nunca expuesta al navegador).
- **`/admin`** — páginas Astro + `@supabase/supabase-js` corriendo en el navegador con
  **Supabase Auth**. Lee y escribe directo contra Supabase usando la *anon key*; la
  seguridad real la da **Row Level Security** (RLS), no el código del panel.
- **Supabase / Postgres** — base de datos, autenticación y RLS. Es la única pieza de
  infraestructura nueva que hay que crear (el sitio no tenía backend antes).

```
Formulario /registro → fetch → Pages Function (valida) → RPC fn_crear_registro (transaccional)
Panel /admin          → supabase-js (sesión del admin) → tablas protegidas por RLS
```

## 1. Crear el proyecto Supabase

1. Crea un proyecto nuevo en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** y pega el contenido completo de
   [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql). Ejecútalo.
   Crea las tablas, los índices, las políticas RLS y las funciones (`fn_crear_registro`,
   `is_admin()`, triggers de auditoría). Es seguro volver a ejecutarlo sólo si la base
   está vacía (usa `create table`, no `create table if not exists`).
3. Copia la URL del proyecto y las claves. El dashboard de Supabase las separó en dos
   lugares (esto cambió durante 2026, así que si viste una guía vieja que dice
   "Settings → API" a secas, ya no es así):
   - **Project URL**: en **Settings → API Settings** (o el botón **Connect** que aparece
     arriba en la vista general del proyecto, que también la muestra) → `PUBLIC_SUPABASE_URL`
     / `SUPABASE_URL`.
   - **Claves**: en **Settings → API Keys**. Ahí vas a ver dos sistemas posibles —
     cualquiera de los dos funciona con este código, no hay que cambiar nada:
     - Si tu proyecto es nuevo, probablemente veas **Publishable key** (`sb_publishable_...`)
       y **Secret keys** (`sb_secret_...`) por defecto → úsalas para
       `PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` respectivamente.
     - Si en cambio ves una pestaña **Legacy API Keys**, ahí están las clásicas `anon` y
       `service_role` → sirven exactamente igual.
   - ⚠️ La que sea que uses como "secret"/`service_role`: nunca la publiques, nunca la
     pongas en una variable `PUBLIC_*`.

## 2. Variables de entorno

Hay dos archivos de ejemplo porque hay dos contextos de ejecución distintos:

| Archivo | Para qué | Dónde se usa |
|---|---|---|
| `.env.example` → copiar a `.env` | Variables `PUBLIC_*`, visibles en el navegador | Astro (build del panel `/admin`) |
| `.dev.vars.example` → copiar a `.dev.vars` | Secretos de servidor | Cloudflare Pages Functions (`/api/registro`) |

En producción (Cloudflare Pages, vía dashboard → **Settings → Environment variables**)
hay que configurar ambos grupos de variables ahí — los archivos `.env` / `.dev.vars` son
sólo para desarrollo local y nunca se commitean (ver `.gitignore`).

## 3. Crear los primeros usuarios administrativos

No hay registro público de administradores (a propósito). El flujo es:

1. En **Supabase Dashboard → Authentication → Users**, crea el usuario con su correo y
   una contraseña (o mándale un magic link/invite, como prefieras).
2. Al crearse, un trigger (`handle_new_auth_user`) le crea automáticamente una fila en
   `admin_profiles` con `active = false`. Todavía no puede entrar al panel.
3. En **SQL Editor**, actívalo:
   ```sql
   update admin_profiles
   set active = true, role = 'ADMIN', display_name = 'Nombre Apellido'
   where user_id = (select id from auth.users where email = 'correo@firehouse.cl');
   ```
   `role` puede ser `ADMIN` o `GESTOR` — en este MVP ambos roles tienen los mismos
   permisos dentro del panel (no hay RBAC granular todavía, a propósito).
4. Esa persona ya puede entrar en `/admin/login` con su correo y contraseña.

## 4. Ejecutar localmente

```bash
npm install
cp .env.example .env            # completa con tus valores de Supabase
cp .dev.vars.example .dev.vars  # completa con tus valores de Supabase

npm run dev                     # sitio + /registro en http://localhost:4321
npx wrangler pages dev dist --compatibility-date=2026-08-24  # para probar /api/registro localmente
```

`astro dev` no ejecuta las Pages Functions — para probar el endpoint `/api/registro`
completo hay que compilar (`npm run build`) y servirlo con `wrangler pages dev`, que sí
simula el runtime de Cloudflare y lee `.dev.vars`.

## 5. Desplegar

El deploy sigue igual que antes (Cloudflare Pages conectado al repo de GitHub, build
command `npm run build`, output `dist`). Lo único nuevo es configurar en el dashboard de
Cloudflare Pages las variables de entorno de la sección 2, para **Production** y para
**Preview** si quieres probar en ramas.

Opcionales (el sistema funciona sin ellos, simplemente con menos protecciones):
- **Turnstile**: crea un site en Cloudflare Turnstile, agrega `TURNSTILE_SECRET_KEY` a
  las Functions y `turnstileToken` se empezará a verificar automáticamente.
- **Rate limiting por IP**: crea un KV Namespace en Cloudflare y enlázalo como binding
  `RATE_LIMIT_KV` en Settings → Functions. Sin este binding, `/api/registro` sigue
  protegido por honeypot + verificación de tiempo de llenado, sólo que sin límite duro
  por IP.

## 6. Probar el formulario público

1. Ve a `/registro` en el navegador.
2. Completa los 3 pasos (puedes ir y volver sin perder datos).
3. Al enviar, deberías ver la pantalla "¡Listo!" con el nombre del/los atleta(s).
4. Verifica en Supabase (**Table Editor**) que se crearon: una fila en `apoderados`, una
   en `atletas` por cada atleta, una en `casos_crm` por cada atleta con `estado = NUEVO`,
   y una interacción automática `NOTA` por caso.
5. Doble clic en "Enviar" o reenviar el mismo `submissionId` no debe duplicar nada
   (`registro_submissions` controla la idempotencia).

## 7. Probar el panel CRM

1. Entra a `/admin/login` con un usuario ya activado (paso 3).
2. En el dashboard deberías ver los KPIs y el caso recién creado en la tabla, ordenado
   arriba si su próxima acción está vencida o es para hoy.
3. Filtra por journey/estado/responsable/fecha y busca por nombre, teléfono o email.
4. Abre la ficha: deberías poder ver los datos del atleta y del apoderado, abrir
   WhatsApp/email, cambiar el estado (revisa que se registre solo en el historial),
   asignar responsable, definir próxima acción + fecha, y agregar una nota manual.
5. Cambia el estado a `INSCRITO`: la próxima acción y su fecha deberían limpiarse solas.

## Estructura principal

```
src/lib/crm/            Modelo, validación, journey, formato — sin dependencias de UI
  types.ts / constants.ts   Tipos y enums centralizados (fuente única de verdad)
  validation.ts              Normalización de teléfono/email/nombres, cálculo de edad
  journey.ts                 Clasificación automática de journey (regla de negocio)
  registro.ts                 Orquesta la validación completa del formulario público
  comunas.ts                  Las 346 comunas de Chile (reutilizable en todo el sitio)
  admin-api.ts                 Acceso a datos + lógica pura de orden/filtro del panel
  format.ts / auth.ts / supabase-client.ts   Utilidades compartidas del panel admin

src/scripts/             Lógica de cliente (una por página, sin framework)
  registro-form.ts · admin-login.ts · admin-dashboard.ts · admin-caso.ts

src/pages/
  registro.astro · privacidad.astro
  admin/login.astro · admin/index.astro · admin/caso.astro

functions/api/registro.ts   Cloudflare Pages Function — único endpoint de escritura pública

supabase/migrations/0001_init.sql   Esquema completo: tablas, índices, RLS, triggers, RPC
```

## Tests

```bash
npm test   # node --test, sin dependencias adicionales — 43 tests
```

Cubren: normalización de teléfono/email, cálculo de edad, clasificación de journey (los
4 casos funcionales del documento de requerimientos + duplicación de atletas + honeypot),
y el orden/filtrado de casos del panel admin (vencidos/hoy/nuevos/resto).

## Qué quedó deliberadamente fuera de este MVP

Pagos, mensualidades, facturación, control de asistencia, ficha médica, documentos,
gestión de competencias, uniformes, portal del apoderado, notificaciones push, API
oficial de WhatsApp, campañas de email/SMS, IA dentro del CRM, RBAC granular entre
`ADMIN`/`GESTOR`, y fusión automática de apoderados duplicados (se marcan, no se
fusionan). Todo esto está fuera de alcance a propósito, según el documento de
requerimientos original.
