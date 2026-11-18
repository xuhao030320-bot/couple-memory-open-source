-- 留言页的喜好备忘与住过的酒店测评。
begin;

create table if not exists public.couple_notes (
  couple_id uuid primary key references public.couples(id) on delete cascade,
  likes text not null default '',
  dislikes text not null default '',
  updated_at timestamptz not null default now(),
  constraint couple_notes_likes_length check (char_length(likes) <= 1000),
  constraint couple_notes_dislikes_length check (char_length(dislikes) <= 1000)
);

create table if not exists public.hotel_reviews (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  hotel_name text not null,
  city text not null default '',
  stayed_at date,
  rating integer not null default 5,
  review text not null default '',
  created_at timestamptz not null default now(),
  constraint hotel_reviews_name_length check (char_length(btrim(hotel_name)) between 1 and 80),
  constraint hotel_reviews_city_length check (char_length(city) <= 50),
  constraint hotel_reviews_review_length check (char_length(review) <= 1000),
  constraint hotel_reviews_rating_range check (rating between 1 and 5)
);

create index if not exists hotel_reviews_couple_stayed_idx
  on public.hotel_reviews (couple_id, stayed_at desc, created_at desc);

drop trigger if exists couple_notes_set_updated_at on public.couple_notes;
create trigger couple_notes_set_updated_at
before update on public.couple_notes
for each row execute function public.set_updated_at();

alter table public.couple_notes enable row level security;
alter table public.hotel_reviews enable row level security;

drop policy if exists couple_notes_select_member on public.couple_notes;
create policy couple_notes_select_member
on public.couple_notes for select to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists couple_notes_insert_member on public.couple_notes;
create policy couple_notes_insert_member
on public.couple_notes for insert to authenticated
with check (public.is_couple_member(couple_id));

drop policy if exists couple_notes_update_member on public.couple_notes;
create policy couple_notes_update_member
on public.couple_notes for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

drop policy if exists hotel_reviews_select_member on public.hotel_reviews;
create policy hotel_reviews_select_member
on public.hotel_reviews for select to authenticated
using (public.is_couple_member(couple_id));

drop policy if exists hotel_reviews_insert_member on public.hotel_reviews;
create policy hotel_reviews_insert_member
on public.hotel_reviews for insert to authenticated
with check (public.is_couple_member(couple_id) and created_by = auth.uid());

drop policy if exists hotel_reviews_delete_member on public.hotel_reviews;
create policy hotel_reviews_delete_member
on public.hotel_reviews for delete to authenticated
using (public.is_couple_member(couple_id));

revoke all on table public.couple_notes, public.hotel_reviews from public, anon, authenticated;
grant select, insert on table public.couple_notes to authenticated;
grant update (likes, dislikes) on table public.couple_notes to authenticated;
grant select, insert, delete on table public.hotel_reviews to authenticated;
grant all on table public.couple_notes, public.hotel_reviews to service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couple_notes'
  ) then
    execute 'alter publication supabase_realtime add table public.couple_notes';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hotel_reviews'
  ) then
    execute 'alter publication supabase_realtime add table public.hotel_reviews';
  end if;
end;
$$;

commit;
