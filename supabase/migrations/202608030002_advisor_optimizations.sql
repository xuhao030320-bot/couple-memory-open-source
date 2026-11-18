-- Advisor follow-up: cover foreign keys and evaluate auth.uid() once per query.
begin;

create index if not exists couples_created_by_idx
  on public.couples (created_by);
create index if not exists memories_author_id_idx
  on public.memories (author_id);
create index if not exists memory_photos_couple_id_idx
  on public.memory_photos (couple_id);
create index if not exists memory_photos_memory_couple_idx
  on public.memory_photos (memory_id, couple_id);
create index if not exists memory_photos_uploaded_by_idx
  on public.memory_photos (uploaded_by);
create index if not exists wishes_created_by_idx
  on public.wishes (created_by);

drop policy if exists profiles_select_self_or_partner on public.profiles;
create policy profiles_select_self_or_partner
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
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
with check (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists memories_insert_member on public.memories;
create policy memories_insert_member
on public.memories for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and author_id = (select auth.uid())
);

drop policy if exists memory_photos_insert_member on public.memory_photos;
create policy memory_photos_insert_member
on public.memory_photos for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and uploaded_by = (select auth.uid())
);

drop policy if exists wishes_insert_member on public.wishes;
create policy wishes_insert_member
on public.wishes for insert
to authenticated
with check (
  public.is_couple_member(couple_id)
  and created_by = (select auth.uid())
);

commit;
