-- 留言墙：一方写给另一方、到点才揭开的短留言。
-- 结构完全沿用 20260808173515_add_anniversaries.sql 的新表模板。
begin;

create table public.messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  text text not null,
  reveal_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint messages_text_length
    check (pg_catalog.char_length(pg_catalog.btrim(text)) between 1 and 500)
);

create index messages_couple_created_idx
  on public.messages (couple_id, created_at desc);
create index messages_created_by_idx
  on public.messages (created_by);

create trigger messages_set_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

alter table public.messages enable row level security;

-- 发送者随时可见自己的留言；接收者要等 reveal_at 到了才能看到。
-- 「未到点的留言对接收者完全不可见」由 RLS 强制，而不是依赖前端过滤。
create policy messages_select_revealed
on public.messages for select
to authenticated
using (
  public.is_couple_member(couple_id)
  and (created_by = (select auth.uid()) or reveal_at is null or reveal_at <= pg_catalog.now())
);

create policy messages_insert_member
on public.messages for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and created_by = (select auth.uid())
);

-- 只有发送者本人能删除自己的留言。
create policy messages_delete_owner
on public.messages for delete
to authenticated
using (created_by = (select auth.uid()));

-- 刻意不建 UPDATE 政策：留言发出后文本与揭开时间都不可修改。

revoke all on table public.messages
from public, anon, authenticated;

grant select, insert, delete on table public.messages to authenticated;
-- 刻意不给任何 update 授权（列级也不给）：留言内容与揭开时间发送后不可变。
grant all on table public.messages to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

commit;
