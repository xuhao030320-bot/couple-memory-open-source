-- 愿望分类新增「想吃的」（food），现有分类与数据全部保留。
-- 沿用 20260815_add_wish_category.sql 的幂等写法：drop + add 约束。
begin;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'wishes_category_allowed'
      and conrelid = 'public.wishes'::regclass
  ) then
    alter table public.wishes
      drop constraint wishes_category_allowed;
  end if;
end;
$$;

alter table public.wishes
  add constraint wishes_category_allowed
  check (category in ('long_term', 'daily', 'food'));

commit;
