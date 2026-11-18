begin;

create table if not exists public.partner_notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  text text not null,
  kind text not null check (kind in ('like', 'care')),
  created_at timestamptz default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  legacy boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint partner_notes_text_length check (char_length(btrim(text)) between 1 and 1000),
  constraint partner_notes_publication_time check (legacy or created_at is not null)
);

create index if not exists partner_notes_couple_created_idx
  on public.partner_notes (couple_id, created_at desc nulls last, id);

drop trigger if exists partner_notes_set_updated_at on public.partner_notes;
create trigger partner_notes_set_updated_at before update on public.partner_notes
  for each row execute function public.set_updated_at();

-- 一次导入标记与条目在同一事务提交；重跑迁移不会覆盖编辑或复活已删除条目。
create table if not exists public.partner_note_migrations (
  couple_id uuid primary key references public.couples(id) on delete cascade,
  migrated_at timestamptz not null default now()
);

with first_migrations as (
  insert into public.partner_note_migrations (couple_id)
    select couple_id from public.couple_notes
    on conflict (couple_id) do nothing returning couple_id
), old_lines as (
  select notes.couple_id, fields.kind, lines.ordinality, btrim(lines.line) as text
  from public.couple_notes notes
  join first_migrations using (couple_id)
  cross join lateral (values ('like', notes.likes), ('care', notes.dislikes)) fields(kind, content)
  cross join lateral regexp_split_to_table(fields.content, E'\\r\\n|\\r|\\n')
    with ordinality as lines(line, ordinality)
  where char_length(btrim(lines.line)) > 0
)
insert into public.partner_notes (id, couple_id, text, kind, created_at, created_by, legacy)
  select md5(couple_id::text || ':' || kind || ':' || ordinality::text)::uuid,
    couple_id, text, kind, null, null, true from old_lines
  on conflict (id) do nothing;

alter table public.partner_notes enable row level security;
alter table public.partner_note_migrations enable row level security;

drop policy if exists partner_notes_select_member on public.partner_notes;
create policy partner_notes_select_member on public.partner_notes for select to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists partner_notes_insert_member on public.partner_notes;
create policy partner_notes_insert_member on public.partner_notes for insert to authenticated
  with check (public.is_couple_member(couple_id) and created_by = (select auth.uid())
    and created_at is not null and not legacy);

drop policy if exists partner_notes_update_member on public.partner_notes;
create policy partner_notes_update_member on public.partner_notes for update to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

drop policy if exists partner_notes_delete_member on public.partner_notes;
create policy partner_notes_delete_member on public.partner_notes for delete to authenticated
  using (public.is_couple_member(couple_id));

revoke all on table public.partner_notes, public.partner_note_migrations from public, anon, authenticated;
grant select, delete on table public.partner_notes to authenticated;
-- 时间、作者和ID全部由数据库生成，客户端只能提供正文和分类。
grant insert (couple_id, text, kind) on public.partner_notes to authenticated;
grant update (text, kind) on public.partner_notes to authenticated;
grant all on table public.partner_notes, public.partner_note_migrations to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'partner_notes'
    ) then
    alter publication supabase_realtime add table public.partner_notes;
  end if;
end;
$$;

commit;
