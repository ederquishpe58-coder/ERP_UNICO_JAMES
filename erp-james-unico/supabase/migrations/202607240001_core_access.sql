-- ERP Único James / Bless Flower
-- Núcleo canónico multiempresa y control de acceso para ambiente TEST.
--
-- Alcance deliberado:
--   * crea solamente empresas, perfiles, membresías, permisos, estado puente y auditoría;
--   * NO crea usuarios en auth.users;
--   * NO carga datos operativos;
--   * NO habilita facturación SRI en producción;
--   * el permiso efectivo de una ruta es:
--       capacidad de la empresa (techo en frontend) ∩ permiso de usuario (esta migración).
--
-- El alta inicial de un usuario exige:
--   1. crear primero el usuario en Supabase Auth desde un backend con service_role;
--   2. ejecutar public.erp_bootstrap_user_access(...) con service_role.
-- anon y authenticated no pueden ejecutar el bootstrap.

begin;

-- ---------------------------------------------------------------------------
-- Empresas canónicas
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  company_key text not null,
  company_code text not null,
  legal_name text not null,
  commercial_name text not null,
  tax_id text not null,
  sri_environment text not null default 'TEST',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint companies_company_key_unique unique (company_key),
  constraint companies_company_code_unique unique (company_code),
  constraint companies_tax_id_unique unique (tax_id),
  constraint companies_company_key_format check (
    company_key ~ '^COMP-[A-Z0-9]+(?:-[A-Z0-9]+)*$'
  ),
  constraint companies_company_code_format check (
    company_code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'
  ),
  constraint companies_tax_id_format check (tax_id ~ '^[0-9]{13}$'),
  constraint companies_sri_environment_check check (
    sri_environment in ('TEST', 'PRODUCTION')
  ),
  constraint companies_metadata_object check (jsonb_typeof(metadata) = 'object')
);

comment on table public.companies is
  'Catálogo canónico de empresas. Será reutilizado por acceso, persistencia y SRI.';
comment on column public.companies.company_key is
  'Clave estable usada por el frontend, por ejemplo COMP-BLESS-FLOWER.';
comment on column public.companies.sri_environment is
  'TEST o PRODUCTION. Esta migración deja ambas empresas únicamente en TEST.';

insert into public.companies (
  id,
  company_key,
  company_code,
  legal_name,
  commercial_name,
  tax_id,
  sri_environment,
  metadata
)
values
  (
    '10000000-0000-4000-8000-000000000001'::uuid,
    'COMP-BLESS-FLOWER',
    'BLESS',
    'Lanchimba Tutillo Manuel Clemente',
    'Bless Flower',
    '1717637084001',
    'TEST',
    '{"accounting_mode":"FULL","inventory_owner":true}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000002'::uuid,
    'COMP-IMPERIO-FLOWERS',
    'IMPERIO',
    'Sandy Anahi Lanchimba Tipanluisa',
    'Imperio Flowers',
    '1727970137001',
    'TEST',
    '{"accounting_mode":"BASIC_COMMERCIAL","inventory_owner":false,"availability_source_company_key":"COMP-BLESS-FLOWER"}'::jsonb
  )
on conflict (company_key) do nothing;

-- ---------------------------------------------------------------------------
-- Usuarios, membresías y permisos por ruta
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  username text,
  phone text,
  locale text not null default 'es-EC',
  timezone text not null default 'America/Guayaquil',
  default_company_id uuid references public.companies(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_profiles_display_name_not_blank check (btrim(display_name) <> ''),
  constraint user_profiles_username_format check (
    username is null or username ~ '^[A-Za-z0-9._-]{3,64}$'
  )
);

create unique index user_profiles_username_ci_unique
  on public.user_profiles (lower(username))
  where username is not null;

comment on table public.user_profiles is
  'Perfil ERP enlazado 1:1 con auth.users. No crea ni reemplaza usuarios de Supabase Auth.';

create table public.user_company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  membership_role text not null default 'VIEWER',
  membership_status text not null default 'ACTIVE',
  is_default boolean not null default false,
  display_name_override text,
  area text,
  job_title text,
  notes text,
  valid_from date,
  valid_until date,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_company_memberships_company_user_unique unique (company_id, user_id),
  constraint user_company_memberships_role_check check (
    membership_role in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER')
  ),
  constraint user_company_memberships_status_check check (
    membership_status in ('ACTIVE', 'SUSPENDED', 'REVOKED')
  ),
  constraint user_company_memberships_validity_check check (
    valid_until is null or valid_from is null or valid_until >= valid_from
  ),
  constraint user_company_memberships_display_name_check check (
    display_name_override is null or btrim(display_name_override) <> ''
  )
);

create unique index user_company_memberships_one_default_per_user
  on public.user_company_memberships (user_id)
  where is_default and membership_status = 'ACTIVE';

create index user_company_memberships_user_idx
  on public.user_company_memberships (user_id, membership_status);
create index user_company_memberships_company_idx
  on public.user_company_memberships (company_id, membership_status);

comment on table public.user_company_memberships is
  'Relación editable usuario-empresa; controla acceso base, cargo, área y estado.';
comment on column public.user_company_memberships.membership_role is
  'OWNER/ADMIN administran accesos. Las rutas visibles siguen dependiendo de permisos explícitos.';

create table public.user_route_permissions (
  company_id uuid not null,
  user_id uuid not null,
  route_id text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_print boolean not null default false,
  can_export boolean not null default false,
  permission_scope jsonb not null default '{}'::jsonb,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (company_id, user_id, route_id),
  constraint user_route_permissions_membership_fk
    foreign key (company_id, user_id)
    references public.user_company_memberships(company_id, user_id)
    on delete cascade,
  constraint user_route_permissions_route_format check (
    route_id ~ '^(?:\*|[a-z0-9][a-z0-9._:-]{0,127})$'
  ),
  constraint user_route_permissions_scope_object check (
    jsonb_typeof(permission_scope) = 'object'
  )
);

create index user_route_permissions_user_idx
  on public.user_route_permissions (user_id, company_id);

comment on table public.user_route_permissions is
  'Permisos explícitos por empresa, usuario y ruta. Ausencia de fila equivale a denegado.';
comment on column public.user_route_permissions.route_id is
  'Identificador de navegación del ERP. * actúa como permiso general y una fila exacta lo sobreescribe.';
comment on column public.user_route_permissions.permission_scope is
  'Reserva JSON para alcances futuros; no amplía las capacidades permitidas a la empresa.';

-- ---------------------------------------------------------------------------
-- Persistencia puente versionada
-- ---------------------------------------------------------------------------

create table public.erp_company_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  revision bigint not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint erp_company_state_json_object check (jsonb_typeof(state_json) = 'object'),
  constraint erp_company_state_schema_version_positive check (schema_version > 0),
  constraint erp_company_state_revision_nonnegative check (revision >= 0)
);

comment on table public.erp_company_state is
  'Persistencia puente por empresa. revision aplica bloqueo optimista para evitar sobreescrituras entre pestañas.';

-- ---------------------------------------------------------------------------
-- Auditoría de accesos
-- ---------------------------------------------------------------------------

create table public.erp_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  route_id text not null,
  requested_action text not null,
  allowed boolean not null,
  reason_code text not null,
  request_id text,
  source text not null default 'ERP_WEB',
  ip_address inet,
  user_agent text,
  details jsonb not null default '{}'::jsonb,

  constraint erp_access_audit_route_not_blank check (btrim(route_id) <> ''),
  constraint erp_access_audit_action_check check (
    requested_action in ('view', 'create', 'edit', 'delete', 'approve', 'print', 'export')
  ),
  constraint erp_access_audit_details_object check (jsonb_typeof(details) = 'object')
);

create index erp_access_audit_company_time_idx
  on public.erp_access_audit_log (company_id, occurred_at desc);
create index erp_access_audit_user_time_idx
  on public.erp_access_audit_log (user_id, occurred_at desc);
create index erp_access_audit_denied_idx
  on public.erp_access_audit_log (occurred_at desc)
  where not allowed;

comment on table public.erp_access_audit_log is
  'Bitácora inmutable desde clientes autenticados; los eventos se insertan mediante erp_record_access_audit.';

-- ---------------------------------------------------------------------------
-- Sellos de actualización y protección del último propietario
-- ---------------------------------------------------------------------------

create or replace function public.erp_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.erp_stamp_membership_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
      new.updated_by := v_actor;
    end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if v_actor is not null then
      new.updated_by := v_actor;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.erp_stamp_permission_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.granted_by := v_actor;
    end if;
  else
    new.created_at := old.created_at;
    if v_actor is not null then
      new.granted_by := v_actor;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.erp_protect_last_company_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removes_owner boolean;
  v_other_owners integer;
begin
  if old.membership_role <> 'OWNER' or old.membership_status <> 'ACTIVE' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_removes_owner := true;
  else
    v_removes_owner :=
      new.company_id <> old.company_id
      or new.membership_role <> 'OWNER'
      or new.membership_status <> 'ACTIVE';
  end if;

  if not v_removes_owner then
    return new;
  end if;

  select count(*)
    into v_other_owners
  from public.user_company_memberships m
  where m.company_id = old.company_id
    and m.membership_role = 'OWNER'
    and m.membership_status = 'ACTIVE'
    and m.id <> old.id;

  if v_other_owners = 0 then
    raise exception 'No se puede quitar el último OWNER activo de la empresa'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger companies_touch_updated_at
before update on public.companies
for each row execute function public.erp_touch_updated_at();

create trigger user_profiles_touch_updated_at
before update on public.user_profiles
for each row execute function public.erp_touch_updated_at();

create trigger memberships_stamp_actor
before insert or update on public.user_company_memberships
for each row execute function public.erp_stamp_membership_actor();

create trigger memberships_touch_updated_at
before update on public.user_company_memberships
for each row execute function public.erp_touch_updated_at();

create trigger memberships_protect_last_owner
before update or delete on public.user_company_memberships
for each row execute function public.erp_protect_last_company_owner();

create trigger route_permissions_stamp_actor
before insert or update on public.user_route_permissions
for each row execute function public.erp_stamp_permission_actor();

create trigger route_permissions_touch_updated_at
before update on public.user_route_permissions
for each row execute function public.erp_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Funciones de autorización seguras (evitan recursión de RLS)
-- ---------------------------------------------------------------------------

create or replace function public.erp_is_active_user(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
      p_user_id = auth.uid()
      or coalesce(auth.role()::text, '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin')
    )
    and exists (
      select 1
      from public.user_profiles p
      where p.user_id = p_user_id
        and p.is_active
    );
$$;

create or replace function public.erp_is_company_member(
  p_company_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
      p_user_id = auth.uid()
      or coalesce(auth.role()::text, '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin')
    )
    and exists (
      select 1
      from public.user_company_memberships m
      join public.user_profiles p on p.user_id = m.user_id
      join public.companies c on c.id = m.company_id
      where m.company_id = p_company_id
        and m.user_id = p_user_id
        and m.membership_status = 'ACTIVE'
        and (m.valid_from is null or m.valid_from <= current_date)
        and (m.valid_until is null or m.valid_until >= current_date)
        and p.is_active
        and c.is_active
    );
$$;

create or replace function public.erp_is_company_admin(
  p_company_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.erp_is_company_member(p_company_id, p_user_id)
    and exists (
      select 1
      from public.user_company_memberships m
      where m.company_id = p_company_id
        and m.user_id = p_user_id
        and m.membership_role in ('OWNER', 'ADMIN')
        and m.membership_status = 'ACTIVE'
    );
$$;

create or replace function public.erp_can_manage_membership(
  p_company_id uuid,
  p_target_role text,
  p_actor_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.erp_is_company_member(p_company_id, p_actor_user_id) then false
    when exists (
      select 1
      from public.user_company_memberships actor
      where actor.company_id = p_company_id
        and actor.user_id = p_actor_user_id
        and actor.membership_role = 'OWNER'
        and actor.membership_status = 'ACTIVE'
    ) then true
    when p_target_role <> 'OWNER'
      and exists (
        select 1
        from public.user_company_memberships actor
        where actor.company_id = p_company_id
          and actor.user_id = p_actor_user_id
          and actor.membership_role = 'ADMIN'
          and actor.membership_status = 'ACTIVE'
      ) then true
    else false
  end;
$$;

create or replace function public.erp_can_read_profile(
  p_target_user_id uuid,
  p_actor_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
      p_actor_user_id = auth.uid()
      or coalesce(auth.role()::text, '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin')
    )
    and (
      p_target_user_id = p_actor_user_id
      or exists (
        select 1
        from public.user_company_memberships target_membership
        where target_membership.user_id = p_target_user_id
          and public.erp_is_company_admin(target_membership.company_id, p_actor_user_id)
      )
    );
$$;

create or replace function public.erp_has_route_permission(
  p_company_id uuid,
  p_route_id text,
  p_action text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.erp_is_company_member(p_company_id, p_user_id)
    and coalesce((
      select case lower(p_action)
        when 'view' then permission.can_view
        when 'create' then permission.can_create
        when 'edit' then permission.can_edit
        when 'delete' then permission.can_delete
        when 'approve' then permission.can_approve
        when 'print' then permission.can_print
        when 'export' then permission.can_export
        else false
      end
      from public.user_route_permissions permission
      where permission.company_id = p_company_id
        and permission.user_id = p_user_id
        and permission.route_id in (p_route_id, '*')
      order by (permission.route_id = p_route_id) desc
      limit 1
    ), false);
$$;

comment on function public.erp_has_route_permission(uuid, text, text, uuid) is
  'Evalúa permiso de usuario. El frontend además debe intersectarlo con la capacidad máxima de la empresa.';

-- ---------------------------------------------------------------------------
-- RPC de persistencia con revisión optimista
-- ---------------------------------------------------------------------------

create or replace function public.erp_save_company_state(
  p_company_id uuid,
  p_state_json jsonb,
  p_expected_revision bigint,
  p_schema_version integer default 1
)
returns table (
  company_id uuid,
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_saved public.erp_company_state%rowtype;
begin
  if v_actor is null then
    raise exception 'Se requiere un usuario autenticado'
      using errcode = '28000';
  end if;

  if not public.erp_has_route_permission(
    p_company_id,
    'erp-company-state',
    'edit',
    v_actor
  ) then
    raise exception 'Sin permiso para guardar el estado de esta empresa'
      using errcode = '42501';
  end if;

  if p_state_json is null or jsonb_typeof(p_state_json) <> 'object' then
    raise exception 'state_json debe ser un objeto JSON'
      using errcode = '22023';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected_revision debe ser mayor o igual a cero'
      using errcode = '22023';
  end if;

  if p_schema_version is null or p_schema_version < 1 then
    raise exception 'schema_version debe ser mayor a cero'
      using errcode = '22023';
  end if;

  if p_expected_revision = 0 then
    insert into public.erp_company_state (
      company_id,
      state_json,
      schema_version,
      revision,
      updated_by
    )
    values (
      p_company_id,
      p_state_json,
      p_schema_version,
      1,
      v_actor
    )
    on conflict (company_id) do nothing
    returning * into v_saved;
  else
    update public.erp_company_state state_row
      set state_json = p_state_json,
          schema_version = p_schema_version,
          revision = state_row.revision + 1,
          updated_by = v_actor,
          updated_at = now()
    where state_row.company_id = p_company_id
      and state_row.revision = p_expected_revision
    returning state_row.* into v_saved;
  end if;

  if v_saved.company_id is null then
    raise exception 'Conflicto de revisión: el estado cambió en otra sesión'
      using errcode = '40001';
  end if;

  return query
    select v_saved.company_id, v_saved.revision, v_saved.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC de auditoría: el servidor calcula allowed, el cliente no lo declara
-- ---------------------------------------------------------------------------

create or replace function public.erp_record_access_audit(
  p_company_id uuid,
  p_route_id text,
  p_action text,
  p_details jsonb default '{}'::jsonb,
  p_request_id text default null,
  p_user_agent text default null
)
returns table (
  event_id uuid,
  allowed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_route text := btrim(coalesce(p_route_id, ''));
  v_allowed boolean := false;
  v_event_id uuid;
  v_reason text;
begin
  if v_actor is null then
    raise exception 'Se requiere un usuario autenticado'
      using errcode = '28000';
  end if;

  if v_route = '' then
    raise exception 'route_id es obligatorio'
      using errcode = '22023';
  end if;

  if v_action not in ('view', 'create', 'edit', 'delete', 'approve', 'print', 'export') then
    raise exception 'Acción de acceso no válida'
      using errcode = '22023';
  end if;

  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'details debe ser un objeto JSON'
      using errcode = '22023';
  end if;

  v_allowed := public.erp_has_route_permission(
    p_company_id,
    v_route,
    v_action,
    v_actor
  );

  v_reason := case
    when v_allowed then 'ALLOWED'
    when not public.erp_is_company_member(p_company_id, v_actor) then 'NO_ACTIVE_MEMBERSHIP'
    else 'PERMISSION_DENIED'
  end;

  insert into public.erp_access_audit_log (
    company_id,
    user_id,
    route_id,
    requested_action,
    allowed,
    reason_code,
    request_id,
    user_agent,
    details
  )
  values (
    p_company_id,
    v_actor,
    v_route,
    v_action,
    v_allowed,
    v_reason,
    nullif(btrim(p_request_id), ''),
    nullif(p_user_agent, ''),
    p_details
  )
  returning id into v_event_id;

  return query select v_event_id, v_allowed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap restringido a service_role
-- ---------------------------------------------------------------------------

create or replace function public.erp_bootstrap_user_access(
  p_user_id uuid,
  p_company_id uuid,
  p_display_name text,
  p_membership_role text default 'VIEWER',
  p_permissions jsonb default '[]'::jsonb,
  p_is_default boolean default false,
  p_replace_permissions boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membership_id uuid;
  v_permission jsonb;
  v_route_id text;
  v_claim_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.role()::text,
    ''
  );
begin
  if session_user not in ('postgres', 'supabase_admin')
     and v_claim_role <> 'service_role' then
    raise exception 'Bootstrap disponible únicamente para service_role'
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'El usuario debe existir primero en Supabase Auth'
      using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.companies c where c.id = p_company_id and c.is_active
  ) then
    raise exception 'Empresa inexistente o inactiva'
      using errcode = '23503';
  end if;

  if btrim(coalesce(p_display_name, '')) = '' then
    raise exception 'display_name es obligatorio'
      using errcode = '22023';
  end if;

  if p_membership_role not in ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER') then
    raise exception 'membership_role no válido'
      using errcode = '22023';
  end if;

  if p_permissions is null or jsonb_typeof(p_permissions) <> 'array' then
    raise exception 'permissions debe ser un arreglo JSON'
      using errcode = '22023';
  end if;

  insert into public.user_profiles (
    user_id,
    display_name,
    default_company_id,
    is_active
  )
  values (
    p_user_id,
    btrim(p_display_name),
    case when p_is_default then p_company_id else null end,
    true
  )
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        default_company_id = case
          when p_is_default then excluded.default_company_id
          else public.user_profiles.default_company_id
        end,
        is_active = true;

  if p_is_default then
    update public.user_company_memberships
      set is_default = false
    where user_id = p_user_id
      and company_id <> p_company_id
      and is_default;
  end if;

  insert into public.user_company_memberships (
    company_id,
    user_id,
    membership_role,
    membership_status,
    is_default
  )
  values (
    p_company_id,
    p_user_id,
    p_membership_role,
    'ACTIVE',
    p_is_default
  )
  on conflict (company_id, user_id) do update
    set membership_role = excluded.membership_role,
        membership_status = 'ACTIVE',
        is_default = excluded.is_default
  returning id into v_membership_id;

  if p_replace_permissions then
    delete from public.user_route_permissions
    where company_id = p_company_id
      and user_id = p_user_id;
  end if;

  for v_permission in
    select value from jsonb_array_elements(p_permissions)
  loop
    if jsonb_typeof(v_permission) <> 'object' then
      raise exception 'Cada permiso debe ser un objeto JSON'
        using errcode = '22023';
    end if;

    v_route_id := btrim(coalesce(v_permission ->> 'route_id', ''));
    if v_route_id !~ '^(?:\*|[a-z0-9][a-z0-9._:-]{0,127})$' then
      raise exception 'route_id no válido: %', v_route_id
        using errcode = '22023';
    end if;

    insert into public.user_route_permissions (
      company_id,
      user_id,
      route_id,
      can_view,
      can_create,
      can_edit,
      can_delete,
      can_approve,
      can_print,
      can_export,
      permission_scope
    )
    values (
      p_company_id,
      p_user_id,
      v_route_id,
      coalesce((v_permission ->> 'view')::boolean, false),
      coalesce((v_permission ->> 'create')::boolean, false),
      coalesce((v_permission ->> 'edit')::boolean, false),
      coalesce((v_permission ->> 'delete')::boolean, false),
      coalesce((v_permission ->> 'approve')::boolean, false),
      coalesce((v_permission ->> 'print')::boolean, false),
      coalesce((v_permission ->> 'export')::boolean, false),
      case
        when jsonb_typeof(v_permission -> 'scope') = 'object'
          then v_permission -> 'scope'
        else '{}'::jsonb
      end
    )
    on conflict (company_id, user_id, route_id) do update
      set can_view = excluded.can_view,
          can_create = excluded.can_create,
          can_edit = excluded.can_edit,
          can_delete = excluded.can_delete,
          can_approve = excluded.can_approve,
          can_print = excluded.can_print,
          can_export = excluded.can_export,
          permission_scope = excluded.permission_scope;
  end loop;

  return v_membership_id;
end;
$$;

comment on function public.erp_bootstrap_user_access(
  uuid, uuid, text, text, jsonb, boolean, boolean
) is
  'Crea perfil/membresía/permisos para un auth.users existente. Ejecutable solo por service_role.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_company_memberships enable row level security;
alter table public.user_route_permissions enable row level security;
alter table public.erp_company_state enable row level security;
alter table public.erp_access_audit_log enable row level security;

create policy companies_select_member
on public.companies
for select
to authenticated
using (public.erp_is_company_member(id, auth.uid()));

create policy user_profiles_select_self_or_admin
on public.user_profiles
for select
to authenticated
using (public.erp_can_read_profile(user_id, auth.uid()));

create policy user_profiles_update_self
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid() and is_active)
with check (user_id = auth.uid() and is_active);

create policy memberships_select_self_or_admin
on public.user_company_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.erp_is_company_admin(company_id, auth.uid())
);

create policy memberships_insert_admin
on public.user_company_memberships
for insert
to authenticated
with check (
  public.erp_can_manage_membership(company_id, membership_role, auth.uid())
);

create policy memberships_update_admin
on public.user_company_memberships
for update
to authenticated
using (
  public.erp_can_manage_membership(company_id, membership_role, auth.uid())
)
with check (
  public.erp_can_manage_membership(company_id, membership_role, auth.uid())
);

create policy memberships_delete_admin
on public.user_company_memberships
for delete
to authenticated
using (
  public.erp_can_manage_membership(company_id, membership_role, auth.uid())
);

create policy route_permissions_select_self_or_admin
on public.user_route_permissions
for select
to authenticated
using (
  user_id = auth.uid()
  or public.erp_is_company_admin(company_id, auth.uid())
);

create policy route_permissions_insert_admin
on public.user_route_permissions
for insert
to authenticated
with check (public.erp_is_company_admin(company_id, auth.uid()));

create policy route_permissions_update_admin
on public.user_route_permissions
for update
to authenticated
using (public.erp_is_company_admin(company_id, auth.uid()))
with check (public.erp_is_company_admin(company_id, auth.uid()));

create policy route_permissions_delete_admin
on public.user_route_permissions
for delete
to authenticated
using (public.erp_is_company_admin(company_id, auth.uid()));

create policy erp_company_state_select_member
on public.erp_company_state
for select
to authenticated
using (public.erp_is_company_member(company_id, auth.uid()));

create policy access_audit_select_self_or_admin
on public.erp_access_audit_log
for select
to authenticated
using (
  user_id = auth.uid()
  or (
    company_id is not null
    and public.erp_is_company_admin(company_id, auth.uid())
  )
);

-- No hay políticas INSERT/UPDATE/DELETE para:
--   companies: administración exclusivamente con service_role;
--   erp_company_state: escritura exclusivamente por RPC con revisión;
--   erp_access_audit_log: inserción exclusivamente por RPC y sin mutación cliente.

-- ---------------------------------------------------------------------------
-- Grants: denegado para anon; mínimo necesario para authenticated
-- ---------------------------------------------------------------------------

revoke all on table public.companies from anon, authenticated;
revoke all on table public.user_profiles from anon, authenticated;
revoke all on table public.user_company_memberships from anon, authenticated;
revoke all on table public.user_route_permissions from anon, authenticated;
revoke all on table public.erp_company_state from anon, authenticated;
revoke all on table public.erp_access_audit_log from anon, authenticated;

grant select on table public.companies to authenticated;
grant select on table public.user_profiles to authenticated;
grant update (display_name, phone, locale, timezone)
  on table public.user_profiles to authenticated;
grant select, insert, update, delete
  on table public.user_company_memberships to authenticated;
grant select, insert, update, delete
  on table public.user_route_permissions to authenticated;
grant select on table public.erp_company_state to authenticated;
grant select on table public.erp_access_audit_log to authenticated;

grant all on table public.companies to service_role;
grant all on table public.user_profiles to service_role;
grant all on table public.user_company_memberships to service_role;
grant all on table public.user_route_permissions to service_role;
grant all on table public.erp_company_state to service_role;
grant all on table public.erp_access_audit_log to service_role;

revoke all on function public.erp_touch_updated_at() from public, anon, authenticated;
revoke all on function public.erp_stamp_membership_actor() from public, anon, authenticated;
revoke all on function public.erp_stamp_permission_actor() from public, anon, authenticated;
revoke all on function public.erp_protect_last_company_owner() from public, anon, authenticated;
revoke all on function public.erp_is_active_user(uuid) from public, anon;
revoke all on function public.erp_is_company_member(uuid, uuid) from public, anon;
revoke all on function public.erp_is_company_admin(uuid, uuid) from public, anon;
revoke all on function public.erp_can_manage_membership(uuid, text, uuid) from public, anon;
revoke all on function public.erp_can_read_profile(uuid, uuid) from public, anon;
revoke all on function public.erp_has_route_permission(uuid, text, text, uuid) from public, anon;
revoke all on function public.erp_save_company_state(uuid, jsonb, bigint, integer) from public, anon;
revoke all on function public.erp_record_access_audit(uuid, text, text, jsonb, text, text) from public, anon;
revoke all on function public.erp_bootstrap_user_access(
  uuid, uuid, text, text, jsonb, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.erp_is_active_user(uuid) to authenticated, service_role;
grant execute on function public.erp_is_company_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.erp_is_company_admin(uuid, uuid) to authenticated, service_role;
grant execute on function public.erp_can_manage_membership(uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.erp_can_read_profile(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.erp_has_route_permission(uuid, text, text, uuid)
  to authenticated, service_role;
grant execute on function public.erp_save_company_state(uuid, jsonb, bigint, integer)
  to authenticated, service_role;
grant execute on function public.erp_record_access_audit(uuid, text, text, jsonb, text, text)
  to authenticated, service_role;
grant execute on function public.erp_bootstrap_user_access(
  uuid, uuid, text, text, jsonb, boolean, boolean
) to service_role;

commit;
