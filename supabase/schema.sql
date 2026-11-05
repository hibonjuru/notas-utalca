-- ==========================================================================
-- Notas Utalca · Esquema Supabase
-- Ejecutar completo en Supabase → SQL Editor.
-- La seguridad de los datos depende de estas políticas RLS.
-- ==========================================================================

-- 1. Perfil público mínimo: RUT sin dígito verificador.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  rut text not null unique check (rut ~ '^[0-9]{6,8}$'),
  created_at timestamptz not null default now()
);

-- 2. Estado completo de la app por usuario (ramos, notas, asistencia).
--    Se guarda como JSONB para mantener el motor actual sin migrar a tablas
--    relacionales. La columna version permite detectar conflictos simples.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"courses":[]}'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

-- 3. RLS: cada usuario solo ve y modifica su propia fila.
alter table public.profiles enable row level security;
alter table public.user_state enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "state_select_own" on public.user_state;
create policy "state_select_own"
on public.user_state
for select
using (auth.uid() = user_id);

drop policy if exists "state_insert_own" on public.user_state;
create policy "state_insert_own"
on public.user_state
for insert
with check (auth.uid() = user_id);

drop policy if exists "state_update_own" on public.user_state;
create policy "state_update_own"
on public.user_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "state_delete_own" on public.user_state;
create policy "state_delete_own"
on public.user_state
for delete
using (auth.uid() = user_id);

-- 4. Trigger: al registrarse, crear perfil y fila de estado.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rut_value text;
begin
  rut_value := new.raw_user_meta_data->>'rut';

  insert into public.profiles (id, rut)
  values (new.id, rut_value);

  insert into public.user_state (user_id)
  values (new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- 5. Mantener updated_at al día.
create or replace function public.touch_user_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_state_touch_updated_at on public.user_state;
create trigger user_state_touch_updated_at
before update on public.user_state
for each row
execute function public.touch_user_state_updated_at();

-- 6. Permisos explícitos: nada para anon; solo authenticated.
revoke all on public.profiles from anon;
revoke all on public.user_state from anon;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.user_state to authenticated;

-- ==========================================================================
-- Checklist de configuración en Supabase:
--
-- 1. Authentication → Providers → Email:
--    - Desactivar "Confirm email" (los emails internos son sintéticos).
--    - Site URL: https://TUUSUARIO.github.io/notas-utalca/
--    - Redirect URLs: https://TUUSUARIO.github.io/notas-utalca/**
--
-- 2. Probar RLS con DOS cuentas:
--    - La cuenta A no debe poder leer ni actualizar user_state de B.
--    - Sin sesión, la anon key no debe leer ninguna fila.
--
-- 3. Nunca usar la service_role key en el frontend.
-- ==========================================================================
