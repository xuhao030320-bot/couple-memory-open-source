-- Shared anniversary collection. Existing single milestones are migrated once.
begin;

create table public.anniversaries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  title text not null,
  event_date date not null,
  repeats_yearly boolean not null default true,
  kind text not null default 'custom',
  note text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint anniversaries_title_length
    check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 80),
  constraint anniversaries_note_length
    check (pg_catalog.char_length(note) <= 280),
  constraint anniversaries_kind_allowed
    check (kind in ('love', 'birthday', 'first', 'trip', 'custom'))
);

create index anniversaries_couple_date_idx
  on public.anniversaries (couple_id, event_date, created_at);
create index anniversaries_created_by_idx
  on public.anniversaries (created_by);

create trigger anniversaries_set_updated_at
before update on public.anniversaries
for each row execute function public.set_updated_at();

alter table public.anniversaries enable row level security;

create policy anniversaries_select_member
on public.anniversaries for select
to authenticated
using (public.is_couple_member(couple_id));

create policy anniversaries_insert_member
on public.anniversaries for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and created_by = (select auth.uid())
);

create policy anniversaries_update_member
on public.anniversaries for update
to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

create policy anniversaries_delete_member
on public.anniversaries for delete
to authenticated
using (public.is_couple_member(couple_id));

revoke all on table public.anniversaries
from public, anon, authenticated;

grant select, insert, delete on table public.anniversaries to authenticated;
grant update (title, event_date, repeats_yearly, kind, note)
  on table public.anniversaries to authenticated;
grant all on table public.anniversaries to service_role;

-- Preserve the old single-milestone setting as the first custom anniversary.
insert into public.anniversaries (
  couple_id,
  created_by,
  title,
  event_date,
  repeats_yearly,
  kind,
  note
)
select
  c.id,
  c.created_by,
  pg_catalog.left(
    coalesce(nullif(pg_catalog.btrim(c.next_milestone_title), ''), '重要的日子'),
    80
  ),
  c.next_milestone_date,
  false,
  'custom',
  '从原来的重要日期迁移'
from public.couples as c
where c.next_milestone_date is not null
  and not exists (
    select 1
    from public.anniversaries as a
    where a.couple_id = c.id
      and a.event_date = c.next_milestone_date
      and a.title = pg_catalog.left(
        coalesce(nullif(pg_catalog.btrim(c.next_milestone_title), ''), '重要的日子'),
        80
      )
  );

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'anniversaries'
  ) then
    alter publication supabase_realtime add table public.anniversaries;
  end if;
end;
$$;

commit;
