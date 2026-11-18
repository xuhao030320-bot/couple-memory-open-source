-- Per-memory 自定义氛围色 theme_color: new column, column-scoped grant, and an
-- extended save_memory_with_media RPC carrying the color through create/update.
-- The old 19-argument overload is left in place (keeps its authenticated grant)
-- so an already-deployed old frontend keeps working during rollout.
begin;

alter table public.memories
  add column if not exists theme_color text;

-- memories 的 UPDATE 授权是列级，新列必须显式授权
--（SECURITY INVOKER 的 RPC 继承调用者权限）。
grant update (theme_color)
  on table public.memories to authenticated;

create or replace function public.save_memory_with_media(
  p_create boolean,
  p_couple_id uuid,
  p_memory_id uuid,
  p_title text,
  p_original_text text,
  p_display_text text,
  p_memory_date date,
  p_location text,
  p_latitude double precision,
  p_longitude double precision,
  p_style text,
  p_template text,
  p_tags text[],
  p_category text,
  p_mood_emoji text,
  p_mood_text text,
  p_is_demo boolean,
  p_is_liked boolean,
  p_theme_color text,
  p_media jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_saved_id uuid;
  v_item jsonb;
  v_media_id uuid;
  v_storage_path text;
  v_existing_path text;
  v_removed_paths jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_media is null or pg_catalog.jsonb_typeof(p_media) <> 'array' then
    raise exception using errcode = '22023', message = 'media must be a JSON array';
  end if;

  if pg_catalog.jsonb_array_length(p_media) > 9 then
    raise exception using errcode = '22023', message = 'a memory can contain at most 9 media items';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_media) as media(item)
    group by media.item ->> 'id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'media ids must be unique';
  end if;

  if p_create then
    insert into public.memories (
      id,
      couple_id,
      author_id,
      title,
      original_text,
      display_text,
      memory_date,
      location,
      latitude,
      longitude,
      style,
      template,
      tags,
      category,
      mood_emoji,
      mood_text,
      is_demo,
      is_liked,
      theme_color
    ) values (
      p_memory_id,
      p_couple_id,
      auth.uid(),
      p_title,
      p_original_text,
      p_display_text,
      p_memory_date,
      p_location,
      p_latitude,
      p_longitude,
      p_style,
      p_template,
      p_tags,
      p_category,
      p_mood_emoji,
      p_mood_text,
      p_is_demo,
      p_is_liked,
      p_theme_color
    )
    returning id into v_saved_id;
  else
    update public.memories
    set
      title = p_title,
      original_text = p_original_text,
      display_text = p_display_text,
      memory_date = p_memory_date,
      location = p_location,
      latitude = p_latitude,
      longitude = p_longitude,
      style = p_style,
      template = p_template,
      tags = p_tags,
      category = p_category,
      mood_emoji = p_mood_emoji,
      mood_text = p_mood_text,
      is_demo = p_is_demo,
      is_liked = p_is_liked,
      theme_color = p_theme_color
    where id = p_memory_id
      and couple_id = p_couple_id
    returning id into v_saved_id;

    if v_saved_id is null then
      raise exception using
        errcode = 'P0002',
        message = 'memory not found or no longer editable';
    end if;
  end if;

  for v_item in
    select media.item
    from pg_catalog.jsonb_array_elements(p_media) as media(item)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'each media item must be an object';
    end if;

    begin
      v_media_id := (v_item ->> 'id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'each media item needs a valid uuid id';
    end;

    v_storage_path := pg_catalog.btrim(v_item ->> 'storage_path');
    if v_storage_path is null or v_storage_path = '' then
      raise exception using errcode = '22023', message = 'each media item needs a storage path';
    end if;

    if pg_catalog.split_part(v_storage_path, '/', 1) <> p_couple_id::text
      or pg_catalog.split_part(v_storage_path, '/', 2) <> p_memory_id::text then
      raise exception using errcode = '22023', message = 'media path does not belong to this memory';
    end if;

    v_existing_path := null;
    update public.memory_photos
    set
      name = coalesce(v_item ->> 'name', ''),
      alt = coalesce(v_item ->> 'alt', ''),
      caption = coalesce(v_item ->> 'caption', ''),
      sort_order = (v_item ->> 'sort_order')::integer,
      role = v_item ->> 'role',
      focus_x = (v_item ->> 'focus_x')::double precision,
      focus_y = (v_item ->> 'focus_y')::double precision,
      media_kind = v_item ->> 'media_kind',
      mime_type = v_item ->> 'mime_type'
    where id = v_media_id
      and memory_id = p_memory_id
      and couple_id = p_couple_id
    returning storage_path into v_existing_path;

    if v_existing_path is not null then
      if v_existing_path <> v_storage_path then
        raise exception using errcode = '22023', message = 'existing media storage path cannot change';
      end if;
    else
      insert into public.memory_photos (
        id,
        memory_id,
        couple_id,
        uploaded_by,
        storage_path,
        name,
        alt,
        caption,
        sort_order,
        role,
        focus_x,
        focus_y,
        media_kind,
        mime_type
      ) values (
        v_media_id,
        p_memory_id,
        p_couple_id,
        auth.uid(),
        v_storage_path,
        coalesce(v_item ->> 'name', ''),
        coalesce(v_item ->> 'alt', ''),
        coalesce(v_item ->> 'caption', ''),
        (v_item ->> 'sort_order')::integer,
        v_item ->> 'role',
        (v_item ->> 'focus_x')::double precision,
        (v_item ->> 'focus_y')::double precision,
        v_item ->> 'media_kind',
        v_item ->> 'mime_type'
      );
    end if;
  end loop;

  with removed as (
    delete from public.memory_photos as photo
    where photo.memory_id = p_memory_id
      and photo.couple_id = p_couple_id
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_media) as media(item)
        where (media.item ->> 'id')::uuid = photo.id
      )
    returning photo.storage_path
  )
  select coalesce(pg_catalog.jsonb_agg(removed.storage_path), '[]'::jsonb)
  into v_removed_paths
  from removed;

  return pg_catalog.jsonb_build_object(
    'id', v_saved_id,
    'removed_paths', v_removed_paths
  );
end;
$$;

-- 撤销旧的 19 参重载对 public/anon 的执行权（保留 authenticated，过渡期旧前端可用）。
do $$
begin
  execute 'revoke all on function public.save_memory_with_media(boolean, uuid, uuid, text, text, text, date, text, double precision, double precision, text, text, text[], text, text, text, boolean, boolean, jsonb) from public, anon';
exception when undefined_function then
  null;
end;
$$;

grant execute on function public.save_memory_with_media(
  boolean,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  double precision,
  double precision,
  text,
  text,
  text[],
  text,
  text,
  text,
  boolean,
  boolean,
  text,
  jsonb
) to authenticated;

commit;
