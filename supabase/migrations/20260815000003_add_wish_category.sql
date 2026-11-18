-- 愿望分类：long_term（长期愿望，默认）与 daily（日常想做的事）。
-- 旧数据与旧前端（不含 category 的写入）都会落到 long_term。
-- 新列有默认值，因此已部署的旧前端在过渡期内的 insert 依然安全。
begin;

alter table public.wishes
  add column if not exists category text not null default 'long_term';

-- PostgreSQL 不支持 ADD CONSTRAINT IF NOT EXISTS，用 DO 块保证整个文件可重复执行。
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'wishes_category_allowed'
      and conrelid = 'public.wishes'::regclass
  ) then
    alter table public.wishes
      add constraint wishes_category_allowed
      check (category in ('long_term', 'daily'));
  end if;
end;
$$;

-- wishes 的 UPDATE 授权是列级（initial_shared_schema 610-612），新列必须显式授权。
grant update (category) on table public.wishes to authenticated;

commit;
