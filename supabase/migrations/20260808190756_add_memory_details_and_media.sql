-- Explicit memory categories, editable moods, map coordinates, and mixed media.
begin;

-- Keep category nullable just long enough to derive it from historical tags.
alter table public.memories
  add column category text,
  add column mood_emoji text not null default '',
  add column mood_text text not null default '',
  add column latitude double precision,
  add column longitude double precision;

update public.memories as memory
set category = case
  when exists (
    select 1
    from pg_catalog.unnest(coalesce(memory.tags, '{}'::text[])) as tag(value)
    where tag.value ilike '%纪念%'
       or tag.value ilike '%周年%'
       or tag.value ilike '%生日%'
       or pg_catalog.lower(pg_catalog.btrim(tag.value)) in ('anniversary', 'birthday')
  ) then 'anniversary'
  when exists (
    select 1
    from pg_catalog.unnest(coalesce(memory.tags, '{}'::text[])) as tag(value)
    where tag.value ilike '%旅行%'
       or tag.value ilike '%旅途%'
       or pg_catalog.lower(pg_catalog.btrim(tag.value)) in ('travel', 'trip')
  ) then 'travel'
  else 'daily'
end;

alter table public.memories
  alter column category set default 'daily',
  alter column category set not null,
  add constraint memories_category_allowed
    check (category in ('daily', 'travel', 'anniversary')),
  add constraint memories_mood_emoji_length
    check (pg_catalog.char_length(mood_emoji) <= 32),
  add constraint memories_mood_text_length
    check (pg_catalog.char_length(mood_text) <= 80),
  add constraint memories_latitude_range
    check (latitude is null or latitude between -90 and 90),
  add constraint memories_longitude_range
    check (longitude is null or longitude between -180 and 180),
  add constraint memories_coordinates_pair
    check ((latitude is null) = (longitude is null));

alter table public.memory_photos
  add column media_kind text not null default 'image',
  add column mime_type text not null default 'application/octet-stream';

update public.memory_photos
set
  media_kind = case
    when pg_catalog.lower(storage_path) like '%.mp4'
      or pg_catalog.lower(storage_path) like '%.mov'
      or pg_catalog.lower(storage_path) like '%.webm'
      or pg_catalog.lower(storage_path) like '%.m4v'
      then 'video'
    else 'image'
  end,
  mime_type = case
    when pg_catalog.lower(storage_path) like '%.png' then 'image/png'
    when pg_catalog.lower(storage_path) like '%.webp' then 'image/webp'
    when pg_catalog.lower(storage_path) like '%.gif' then 'image/gif'
    when pg_catalog.lower(storage_path) like '%.heic' then 'image/heic'
    when pg_catalog.lower(storage_path) like '%.heif' then 'image/heif'
    when pg_catalog.lower(storage_path) like '%.jpg'
      or pg_catalog.lower(storage_path) like '%.jpeg' then 'image/jpeg'
    when pg_catalog.lower(storage_path) like '%.mp4' then 'video/mp4'
    when pg_catalog.lower(storage_path) like '%.mov' then 'video/quicktime'
    when pg_catalog.lower(storage_path) like '%.webm' then 'video/webm'
    when pg_catalog.lower(storage_path) like '%.m4v' then 'video/x-m4v'
    else 'application/octet-stream'
  end;

alter table public.memory_photos
  add constraint memory_photos_media_kind_allowed
    check (media_kind in ('image', 'video')),
  add constraint memory_photos_mime_type_length
    check (pg_catalog.char_length(mime_type) between 3 and 127),
  add constraint memory_photos_kind_matches_mime
    check (
      mime_type = 'application/octet-stream'
      or (media_kind = 'image' and pg_catalog.lower(mime_type) like 'image/%')
      or (media_kind = 'video' and pg_catalog.lower(mime_type) like 'video/%')
    );

-- Existing application grants are column-scoped, so new editable columns must
-- be granted explicitly without exposing identity or ownership fields.
grant update (category, mood_emoji, mood_text, latitude, longitude)
  on table public.memories to authenticated;
grant update (media_kind, mime_type)
  on table public.memory_photos to authenticated;

-- Keep the existing private bucket and its RLS policies. The application caps
-- each video below 45 MiB, leaving headroom under this 50 MiB bucket limit.
update storage.buckets as bucket
set
  file_size_limit = case
    when bucket.file_size_limit is null then null
    else greatest(bucket.file_size_limit, 52428800::bigint)
  end,
  allowed_mime_types = case
    when bucket.allowed_mime_types is null then null
    else (
      select pg_catalog.array_agg(items.mime_type order by items.mime_type)
      from (
        select distinct media.mime_type
        from pg_catalog.unnest(
          bucket.allowed_mime_types
          || array[
            'video/mp4',
            'video/quicktime',
            'video/webm',
            'video/x-m4v'
          ]::text[]
        ) as media(mime_type)
      ) as items
    )
  end
where bucket.id = 'couple-photos';

commit;
