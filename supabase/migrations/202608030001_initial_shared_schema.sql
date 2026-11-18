-- Initial shared schema for the private two-person memory space.
-- Run once on a fresh Supabase project (or apply through the Supabase CLI).

begin;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_path text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint profiles_display_name_length
    check (pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 50)
);

create table if not exists public.couples (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null default '只此我们',
  start_date date not null,
  next_milestone_title text,
  next_milestone_date date,
  -- The code is nulled as soon as the second member joins.
  invite_code text unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint couples_name_length
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 80),
  constraint couples_invite_code_format
    check (invite_code is null or invite_code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

create table if not exists public.couple_members (
  couple_id uuid not null references public.couples (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (couple_id, user_id),
  -- This private app intentionally allows one active couple per account.
  constraint couple_members_one_couple_per_user unique (user_id)
);

create table if not exists public.memories (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  title text not null default '',
  original_text text not null default '',
  display_text text not null default '',
  memory_date date not null default current_date,
  location text not null default '',
  style text not null default 'cream',
  template text not null default 'hero-note',
  tags text[] not null default '{}'::text[],
  is_demo boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint memories_id_couple_unique unique (id, couple_id),
  constraint memories_style_allowed
    check (style in ('cream', 'film', 'minimal', 'ticket')),
  constraint memories_template_allowed
    check (template in ('hero-note', 'hero-grid', 'film-strip', 'quiet-column'))
);

create table if not exists public.memory_photos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  memory_id uuid not null,
  couple_id uuid not null references public.couples (id) on delete cascade,
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  storage_path text not null unique,
  name text not null default '',
  alt text not null default '',
  caption text not null default '',
  sort_order integer not null default 0,
  role text not null default 'supporting',
  focus_x double precision not null default 0.5,
  focus_y double precision not null default 0.5,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint memory_photos_memory_couple_fk
    foreign key (memory_id, couple_id)
    references public.memories (id, couple_id)
    on delete cascade,
  constraint memory_photos_path_belongs_to_couple
    check (pg_catalog.split_part(storage_path, '/', 1) = couple_id::text),
  constraint memory_photos_sort_order_nonnegative check (sort_order >= 0),
  constraint memory_photos_role_allowed check (role in ('cover', 'supporting')),
  constraint memory_photos_focus_x_range check (focus_x between 0 and 1),
  constraint memory_photos_focus_y_range check (focus_y between 0 and 1)
);

create table if not exists public.wishes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  text text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint wishes_text_length
    check (pg_catalog.char_length(pg_catalog.btrim(text)) between 1 and 500)
);

create index if not exists couple_members_couple_joined_idx
  on public.couple_members (couple_id, joined_at);
create index if not exists memories_couple_date_idx
  on public.memories (couple_id, memory_date desc, created_at desc);
create index if not exists memory_photos_memory_order_idx
  on public.memory_photos (memory_id, sort_order);
create index if not exists wishes_couple_created_idx
  on public.wishes (couple_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists couples_set_updated_at on public.couples;
create trigger couples_set_updated_at
before update on public.couples
for each row execute function public.set_updated_at();

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
before update on public.memories
for each row execute function public.set_updated_at();

drop trigger if exists memory_photos_set_updated_at on public.memory_photos;
create trigger memory_photos_set_updated_at
before update on public.memory_photos
for each row execute function public.set_updated_at();

drop trigger if exists wishes_set_updated_at on public.wishes;
create trigger wishes_set_updated_at
before update on public.wishes
for each row execute function public.set_updated_at();

-- Always create a minimal profile for a newly authenticated account. RPCs also
-- upsert the chosen display name so this remains safe for pre-existing users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  v_display_name := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
      '新成员'
    ),
    50
  );

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- This is deliberately SECURITY DEFINER to avoid recursive RLS evaluation on
-- couple_members. It answers only for auth.uid(), never for a caller-supplied
-- user id, and uses a fixed empty search_path.
create or replace function public.is_couple_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_couple_id is not null
    and exists (
      select 1
      from public.couple_members as cm
      where cm.couple_id = p_couple_id
        and cm.user_id = auth.uid()
    );
$$;

-- Keep the two-member invariant at the table boundary, including privileged
-- imports. Locking the couple row serializes two simultaneous join attempts.
create or replace function public.enforce_couple_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.couples as c
  where c.id = new.couple_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = '情侣空间不存在';
  end if;

  if (
    select pg_catalog.count(*)
    from public.couple_members as cm
    where cm.couple_id = new.couple_id
  ) >= 2 then
    raise exception using
      errcode = 'P0001',
      message = '邀请码无效或当前无法加入';
  end if;

  return new;
end;
$$;

drop trigger if exists couple_members_limit_two on public.couple_members;
create trigger couple_members_limit_two
before insert on public.couple_members
for each row execute function public.enforce_couple_member_limit();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.memories enable row level security;
alter table public.memory_photos enable row level security;
alter table public.wishes enable row level security;

drop policy if exists profiles_select_self_or_partner on public.profiles;
create policy profiles_select_self_or_partner
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.couple_members as target_membership
    where target_membership.user_id = profiles.id
      and public.is_couple_member(target_membership.couple_id)
  )
);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists couples_select_member on public.couples;
create policy couples_select_member
on public.couples for select
to authenticated
using (public.is_couple_member(id));

drop policy if exists couples_update_member on public.couples;
create policy couples_update_member
on public.couples for update
to authenticated
using (public.is_couple_member(id))
with check (public.is_couple_member(id));

drop policy if exists couple_members_select_same_couple on public.couple_members;
create policy couple_members_select_same_couple
on public.couple_members for select
to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists memories_select_member on public.memories;
create policy memories_select_member
on public.memories for select
to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists memories_insert_member on public.memories;
create policy memories_insert_member
on public.memories for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and author_id = auth.uid()
);

drop policy if exists memories_update_member on public.memories;
create policy memories_update_member
on public.memories for update
to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

drop policy if exists memories_delete_member on public.memories;
create policy memories_delete_member
on public.memories for delete
to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists memory_photos_select_member on public.memory_photos;
create policy memory_photos_select_member
on public.memory_photos for select
to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists memory_photos_insert_member on public.memory_photos;
create policy memory_photos_insert_member
on public.memory_photos for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and uploaded_by = auth.uid()
);

drop policy if exists memory_photos_update_member on public.memory_photos;
create policy memory_photos_update_member
on public.memory_photos for update
to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

drop policy if exists memory_photos_delete_member on public.memory_photos;
create policy memory_photos_delete_member
on public.memory_photos for delete
to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists wishes_select_member on public.wishes;
create policy wishes_select_member
on public.wishes for select
to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists wishes_insert_member on public.wishes;
create policy wishes_insert_member
on public.wishes for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and created_by = auth.uid()
);

drop policy if exists wishes_update_member on public.wishes;
create policy wishes_update_member
on public.wishes for update
to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

drop policy if exists wishes_delete_member on public.wishes;
create policy wishes_delete_member
on public.wishes for delete
to authenticated
using (public.is_couple_member(couple_id));

-- ---------------------------------------------------------------------------
-- Authenticated RPCs. Invite lookup never exposes whether a code exists, was
-- already used, or belongs to a full couple.
-- ---------------------------------------------------------------------------

create or replace function public.create_couple(
  p_display_name text,
  p_start_date date
)
returns table (couple_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_couple_id uuid;
  v_invite_code text;
  v_random_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_byte_index integer;
  v_attempt integer;
begin
  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = '请先登录';
  end if;

  if p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 50 then
    raise exception using
      errcode = '22023',
      message = '称呼需为 1 至 50 个字符';
  end if;

  if p_start_date is null then
    raise exception using
      errcode = '22023',
      message = '请填写在一起的日期';
  end if;

  if exists (
    select 1
    from public.couple_members as cm
    where cm.user_id = v_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = '当前账号已经加入情侣空间';
  end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, pg_catalog.btrim(p_display_name))
  on conflict (id) do update
    set display_name = excluded.display_name;

  -- Eight base32 characters (40 bits). Ambiguous 0/O and 1/I are omitted.
  for v_attempt in 1..10 loop
    v_random_bytes := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    v_invite_code := '';

    foreach v_byte_index in array array[0, 1, 2, 3, 4, 5, 9, 10] loop
      v_invite_code := v_invite_code || pg_catalog.substr(
        v_alphabet,
        (pg_catalog.get_byte(v_random_bytes, v_byte_index) % 32) + 1,
        1
      );
    end loop;

    begin
      insert into public.couples (
        start_date,
        invite_code,
        created_by
      )
      values (
        p_start_date,
        v_invite_code,
        v_user_id
      )
      returning id into v_couple_id;

      exit;
    exception
      when unique_violation then
        v_couple_id := null;
    end;
  end loop;

  if v_couple_id is null then
    raise exception using
      errcode = 'P0001',
      message = '暂时无法生成邀请码，请重试';
  end if;

  insert into public.couple_members (couple_id, user_id)
  values (v_couple_id, v_user_id);

  return query select v_couple_id, v_invite_code;
end;
$$;

create or replace function public.join_couple(
  p_invite_code text,
  p_display_name text
)
returns table (couple_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_couple_id uuid;
  v_normalized_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_invite_code, '')));
begin
  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = '请先登录';
  end if;

  if p_display_name is null
     or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 50 then
    raise exception using
      errcode = '22023',
      message = '称呼需为 1 至 50 个字符';
  end if;

  if exists (
    select 1
    from public.couple_members as cm
    where cm.user_id = v_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = '当前账号已经加入情侣空间';
  end if;

  -- Invalid format and an unknown/used/full code deliberately share one error.
  if v_normalized_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
    raise exception using
      errcode = 'P0001',
      message = '邀请码无效或当前无法加入';
  end if;

  select c.id
  into v_couple_id
  from public.couples as c
  where c.invite_code = v_normalized_code
  for update;

  if not found or (
    select pg_catalog.count(*)
    from public.couple_members as cm
    where cm.couple_id = v_couple_id
  ) >= 2 then
    raise exception using
      errcode = 'P0001',
      message = '邀请码无效或当前无法加入';
  end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, pg_catalog.btrim(p_display_name))
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.couple_members (couple_id, user_id)
  values (v_couple_id, v_user_id);

  -- Make the invite single-use and prevent later code probing.
  update public.couples as c
  set invite_code = null
  where c.id = v_couple_id;

  return query select v_couple_id, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Explicit grants: clients may edit content but cannot forge memberships,
-- authorship, couple ids, invitation codes, or audit timestamps.
-- ---------------------------------------------------------------------------

revoke all on table
  public.profiles,
  public.couples,
  public.couple_members,
  public.memories,
  public.memory_photos,
  public.wishes
from public, anon, authenticated;

grant select, insert on table public.profiles to authenticated;
grant update (display_name, avatar_path) on table public.profiles to authenticated;

grant select on table public.couples to authenticated;
grant update (name, start_date, next_milestone_title, next_milestone_date)
  on table public.couples to authenticated;

grant select on table public.couple_members to authenticated;

grant select, insert, delete on table public.memories to authenticated;
grant update (
  title,
  original_text,
  display_text,
  memory_date,
  location,
  style,
  template,
  tags,
  is_demo
) on table public.memories to authenticated;

grant select, insert, delete on table public.memory_photos to authenticated;
grant update (name, alt, caption, sort_order, role, focus_x, focus_y)
  on table public.memory_photos to authenticated;

grant select, insert, delete on table public.wishes to authenticated;
grant update (text, completed, completed_at)
  on table public.wishes to authenticated;

grant all on table
  public.profiles,
  public.couples,
  public.couple_members,
  public.memories,
  public.memory_photos,
  public.wishes
to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.enforce_couple_member_limit() from public, anon, authenticated;
revoke all on function public.is_couple_member(uuid) from public, anon;
grant execute on function public.is_couple_member(uuid) to authenticated, service_role;

revoke all on function public.create_couple(text, date) from public, anon;
grant execute on function public.create_couple(text, date) to authenticated, service_role;

revoke all on function public.join_couple(text, text) from public, anon;
grant execute on function public.join_couple(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private object storage. Every object name must begin with the member's
-- couple UUID, for example: <couple_id>/<memory_id>/<random-name>.webp
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'couple-photos',
  'couple-photos',
  false,
  15728640,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists couple_photos_select_member on storage.objects;
create policy couple_photos_select_member
on storage.objects for select
to authenticated
using (
  bucket_id = 'couple-photos'
  and public.is_couple_member(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

drop policy if exists couple_photos_insert_member on storage.objects;
create policy couple_photos_insert_member
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'couple-photos'
  and public.is_couple_member(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

drop policy if exists couple_photos_update_member on storage.objects;
create policy couple_photos_update_member
on storage.objects for update
to authenticated
using (
  bucket_id = 'couple-photos'
  and public.is_couple_member(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
)
with check (
  bucket_id = 'couple-photos'
  and public.is_couple_member(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

drop policy if exists couple_photos_delete_member on storage.objects;
create policy couple_photos_delete_member
on storage.objects for delete
to authenticated
using (
  bucket_id = 'couple-photos'
  and public.is_couple_member(
    case
      when (storage.foldername(name))[1]
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null
    end
  )
);

-- ---------------------------------------------------------------------------
-- Realtime subscriptions used by both devices.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;

  foreach v_table_name in array array[
    'profiles',
    'couples',
    'couple_members',
    'memories',
    'memory_photos',
    'wishes'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table_name
    ) then
      execute pg_catalog.format(
        'alter publication supabase_realtime add table public.%I',
        v_table_name
      );
    end if;
  end loop;
end;
$$;

commit;
