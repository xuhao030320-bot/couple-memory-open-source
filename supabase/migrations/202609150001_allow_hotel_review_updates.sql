-- Allow members to edit the hotel review fields used by the web app.
drop policy if exists hotel_reviews_update_member on public.hotel_reviews;
create policy hotel_reviews_update_member
on public.hotel_reviews for update to authenticated
using (public.is_couple_member(couple_id))
with check (public.is_couple_member(couple_id));

grant update (hotel_name, city, stayed_at, rating, review)
on table public.hotel_reviews to authenticated;
