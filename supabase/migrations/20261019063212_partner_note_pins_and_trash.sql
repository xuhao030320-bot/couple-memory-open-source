begin;
alter table public.partner_notes add column if not exists pinned boolean not null default false;
grant update (pinned) on public.partner_notes to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
-- Retry receipts retain only a one-way request fingerprint, never message text.
create table if not exists private.message_receipts (
  id uuid primary key,
  couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid,
  request_hash bytea not null
);
alter table private.message_receipts enable row level security;
revoke all on private.message_receipts from public, anon, authenticated;
create or replace function private.message_request_hash(p_couple uuid,p_id uuid,p_author uuid,p_text text,p_reveal timestamptz)
returns bytea language sql immutable set search_path='' as $$
  select pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(p_couple,p_id,p_author,btrim(p_text),extract(epoch from p_reveal))::text,'UTF8'))
$$;
revoke all on function private.message_request_hash(uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated;
create table if not exists public.trash_entries (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null check (kind in ('memory','wish','anniversary','message','partner_note')),
  original_id uuid not null,
  title text not null,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  payload jsonb not null,
  purging boolean not null default false
);
create index if not exists trash_entries_couple_deleted_idx on public.trash_entries(couple_id, deleted_at desc);
alter table public.trash_entries enable row level security;
revoke all on public.trash_entries from public, anon, authenticated;
grant select (id,couple_id,kind,original_id,title,deleted_at,expires_at) on public.trash_entries to authenticated;
grant all on public.trash_entries to service_role;
create policy trash_entries_member_read on public.trash_entries for select to authenticated using (
  public.is_couple_member(couple_id) and
  (kind <> 'message' or payload->>'created_by' = (select auth.uid())::text
   or payload->>'reveal_at' is null or (payload->>'reveal_at')::timestamptz <= now())
);

-- Trigger makes every existing DELETE path transactional, including wishlist batches.
-- Only the private trigger can write immutable archived author/publication metadata.
create or replace function private.archive_deleted_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_payload jsonb; v_photos jsonb;
begin
  if auth.uid() is null then return old; end if; -- trusted administrative/cascade work; anonymous has no DELETE grants
  if not public.is_couple_member(old.couple_id) then raise exception 'NOT_A_MEMBER'; end if;
  v_payload := to_jsonb(old);
  if tg_table_name = 'messages' and v_payload->>'created_by' is distinct from auth.uid()::text then raise exception 'FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.id::text, 0));
  if tg_table_name='messages' then
    insert into private.message_receipts(id,couple_id,created_by,request_hash)
      values(old.id,old.couple_id,(v_payload->>'created_by')::uuid,
        private.message_request_hash(old.couple_id,old.id,(v_payload->>'created_by')::uuid,v_payload->>'text',(v_payload->>'reveal_at')::timestamptz))
      on conflict(id) do nothing;
  end if;
  v_kind := case tg_table_name when 'memories' then 'memory' when 'wishes' then 'wish'
    when 'anniversaries' then 'anniversary' when 'messages' then 'message' else 'partner_note' end;
  v_payload := to_jsonb(old);
  if v_kind = 'memory' then
    select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_photos
      from public.memory_photos p where p.memory_id=old.id and p.couple_id=old.couple_id;
    v_payload := v_payload || jsonb_build_object('_photos',v_photos);
  end if;
  insert into public.trash_entries(couple_id,kind,original_id,title,payload)
    values(old.couple_id,v_kind,old.id,left(coalesce(v_payload->>'title',v_payload->>'text','内容'),60),v_payload);
  return old;
end $$;
revoke all on function private.archive_deleted_entry() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['memories','wishes','anniversaries','messages','partner_notes'] loop
    execute format('drop trigger if exists archive_before_delete on public.%I',t);
    execute format('create trigger archive_before_delete before delete on public.%I for each row execute function private.archive_deleted_entry()',t);
  end loop;
end $$;

create or replace function private.require_trash_member(p_couple_id uuid,p_id uuid)
returns public.trash_entries language plpgsql security definer set search_path='' as $$
declare e public.trash_entries;
begin
  if auth.uid() is null or not public.is_couple_member(p_couple_id) then raise exception 'NOT_A_MEMBER'; end if;
  select * into e from public.trash_entries where id=p_id and couple_id=p_couple_id for update;
  if e.id is not null and e.kind='message' and e.payload->>'created_by' is distinct from auth.uid()::text
    and e.payload->>'reveal_at' is not null and (e.payload->>'reveal_at')::timestamptz > now() then
    raise exception 'MESSAGE_LOCKED';
  end if;
  return e;
end $$;
revoke all on function private.require_trash_member(uuid,uuid) from public, anon, authenticated;

create or replace function private.restore_trash_entry(p_couple_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e public.trash_entries; t text; exists_id uuid;
begin
  e := private.require_trash_member(p_couple_id,p_id);
  if e.id is null then return; end if; -- already restored/purged; retry is safe
  if e.purging then raise exception 'TRASH_PURGING'; end if;
  if e.expires_at<=now() then raise exception 'TRASH_EXPIRED'; end if;
  t := case e.kind when 'memory' then 'memories' when 'wish' then 'wishes'
    when 'anniversary' then 'anniversaries' when 'message' then 'messages' when 'partner_note' then 'partner_notes' end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(e.original_id::text,0));
  execute format('select id from public.%I where id=$1',t) into exists_id using e.original_id;
  if exists_id is not null then raise exception 'RESTORE_CONFLICT'; end if;
  execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).*',t,t) using e.payload;
  if e.kind='memory' then
    insert into public.memory_photos select * from jsonb_populate_recordset(null::public.memory_photos,coalesce(e.payload->'_photos','[]'::jsonb));
  end if;
  delete from public.trash_entries where id=e.id;
end $$;

-- Two-phase purge: failed file deletion leaves the archive available for a retry,
-- while restore is blocked once physical deletion has begun.
create or replace function private.prepare_trash_purge(p_couple_id uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.trash_entries; paths jsonb;
begin
  e := private.require_trash_member(p_couple_id,p_id);
  if e.id is null then return '[]'::jsonb; end if;
  update public.trash_entries set purging=true where id=e.id;
  select coalesce(jsonb_agg(photo->>'storage_path'),'[]'::jsonb) into paths
    from jsonb_array_elements(coalesce(e.payload->'_photos','[]'::jsonb)) photo
    where split_part(photo->>'storage_path','/',1)=p_couple_id::text
      and not exists(select 1 from public.memory_photos p where p.storage_path=photo->>'storage_path');
  select coalesce(jsonb_agg(path.value),'[]'::jsonb) into paths from jsonb_array_elements(paths) path(value)
    where not exists(select 1 from public.trash_entries other,
      jsonb_array_elements(coalesce(other.payload->'_photos','[]'::jsonb)) p
      where other.id<>e.id and not other.purging and p->>'storage_path'=(path.value#>>'{}'));
  return paths;
end $$;
create or replace function private.finish_trash_purge(p_couple_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e public.trash_entries;
begin
  e := private.require_trash_member(p_couple_id,p_id);
  if e.id is null then return; end if;
  if not e.purging then raise exception 'PURGE_NOT_PREPARED'; end if;
  if e.kind='message' then
    insert into private.message_receipts(id,couple_id,created_by,request_hash)
      values(e.original_id,e.couple_id,(e.payload->>'created_by')::uuid,
        private.message_request_hash(e.couple_id,e.original_id,(e.payload->>'created_by')::uuid,e.payload->>'text',(e.payload->>'reveal_at')::timestamptz))
      on conflict(id) do nothing;
  end if;
  delete from public.trash_entries where id=e.id;
end $$;
create or replace function private.retained_media_paths(p_paths text[])
returns text[] language plpgsql security definer set search_path='' as $$
declare path text; result text[] := '{}';
begin
  foreach path in array p_paths loop
    if auth.uid() is null or not exists(select 1 from public.couple_members where user_id=auth.uid() and couple_id::text=split_part(path,'/',1)) then
      raise exception 'NOT_A_MEMBER';
    end if;
    if exists(select 1 from public.trash_entries e,
      jsonb_array_elements(coalesce(e.payload->'_photos','[]'::jsonb)) p where p->>'storage_path'=path) then result:=array_append(result,path); end if;
  end loop;
  return result;
end $$;

-- Public RPCs run as the caller; privileged implementations stay in an unexposed schema.
create or replace function public.restore_trash_entry(p_couple_id uuid,p_id uuid) returns void
language sql security invoker set search_path='' as $$ select private.restore_trash_entry(p_couple_id,p_id) $$;
create or replace function public.prepare_trash_purge(p_couple_id uuid,p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.prepare_trash_purge(p_couple_id,p_id) $$;
create or replace function public.finish_trash_purge(p_couple_id uuid,p_id uuid) returns void
language sql security invoker set search_path='' as $$ select private.finish_trash_purge(p_couple_id,p_id) $$;
create or replace function public.retained_media_paths(p_paths text[]) returns text[]
language sql security invoker set search_path='' as $$ select private.retained_media_paths(p_paths) $$;
revoke all on function private.restore_trash_entry(uuid,uuid),private.prepare_trash_purge(uuid,uuid),private.finish_trash_purge(uuid,uuid),private.retained_media_paths(text[]) from public,anon;
revoke all on function public.restore_trash_entry(uuid,uuid),public.prepare_trash_purge(uuid,uuid),public.finish_trash_purge(uuid,uuid),public.retained_media_paths(text[]) from public,anon;
grant execute on function private.restore_trash_entry(uuid,uuid),private.prepare_trash_purge(uuid,uuid),private.finish_trash_purge(uuid,uuid),private.retained_media_paths(text[]) to authenticated;
grant execute on function public.restore_trash_entry(uuid,uuid),public.prepare_trash_purge(uuid,uuid),public.finish_trash_purge(uuid,uuid),public.retained_media_paths(text[]) to authenticated;

create or replace function private.create_message_once(p_couple_id uuid,p_id uuid,p_text text,p_reveal_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare m public.messages; archived jsonb; receipt private.message_receipts;
begin
  if auth.uid() is null or not public.is_couple_member(p_couple_id) then raise exception 'NOT_A_MEMBER'; end if;
  if p_text is null or char_length(btrim(p_text)) not between 1 and 500 then raise exception 'INVALID_TEXT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  select * into m from public.messages where id=p_id for update;
  if m.id is not null then
    if m.couple_id is distinct from p_couple_id or m.created_by is distinct from auth.uid()
      or m.text is distinct from btrim(p_text) or m.reveal_at is distinct from p_reveal_at then raise exception 'REQUEST_CONFLICT'; end if;
    return;
  end if;
  select * into receipt from private.message_receipts where id=p_id;
  if receipt.id is not null then
    if receipt.couple_id is distinct from p_couple_id or receipt.created_by is distinct from auth.uid()
      or receipt.request_hash is distinct from private.message_request_hash(p_couple_id,p_id,auth.uid(),p_text,p_reveal_at) then raise exception 'REQUEST_CONFLICT'; end if;
    return;
  end if;
  select payload into archived from public.trash_entries where original_id=p_id and kind='message' order by deleted_at desc limit 1;
  if archived is not null then
    if archived->>'couple_id' is distinct from p_couple_id::text or archived->>'created_by' is distinct from auth.uid()::text
      or archived->>'text' is distinct from btrim(p_text) or (archived->>'reveal_at')::timestamptz is distinct from p_reveal_at then raise exception 'REQUEST_CONFLICT'; end if;
    return; -- a late retry must not resurrect a deleted message
  end if;
  insert into private.message_receipts(id,couple_id,created_by,request_hash)
    values(p_id,p_couple_id,auth.uid(),private.message_request_hash(p_couple_id,p_id,auth.uid(),p_text,p_reveal_at));
  insert into public.messages(id,couple_id,created_by,text,reveal_at) values(p_id,p_couple_id,auth.uid(),btrim(p_text),p_reveal_at);
end $$;
create or replace function public.create_message_once(p_couple_id uuid,p_id uuid,p_text text,p_reveal_at timestamptz)
returns void language sql security invoker set search_path='' as $$select private.create_message_once(p_couple_id,p_id,p_text,p_reveal_at)$$;
revoke all on function private.create_message_once(uuid,uuid,text,timestamptz),public.create_message_once(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function private.create_message_once(uuid,uuid,text,timestamptz),public.create_message_once(uuid,uuid,text,timestamptz) to authenticated;

create or replace function private.append_message_reply_once(p_message_id uuid,p_reply_id uuid,p_text text)
returns void language plpgsql security definer set search_path='' as $$
declare m public.messages; r jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_A_MEMBER'; end if;
  if p_text is null or char_length(btrim(p_text)) not between 1 and 500 then raise exception 'INVALID_TEXT'; end if;
  select * into m from public.messages where id=p_message_id for update;
  if m.id is null then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if not public.is_couple_member(m.couple_id) then raise exception 'NOT_A_MEMBER'; end if;
  if m.created_by is distinct from auth.uid() and m.reveal_at>now() then raise exception 'MESSAGE_LOCKED'; end if;
  select value into r from jsonb_array_elements(m.replies) where value->>'id'=p_reply_id::text;
  if r is not null then
    if r->>'createdBy' is distinct from auth.uid()::text or r->>'text' is distinct from btrim(p_text) then raise exception 'REQUEST_CONFLICT'; end if;
    return;
  end if;
  update public.messages set replies=replies||jsonb_build_object('id',p_reply_id::text,'createdBy',auth.uid()::text,'text',btrim(p_text),
    'createdAt',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=p_message_id;
end $$;
create or replace function public.append_message_reply(p_message_id uuid,p_reply_id uuid,p_text text) returns void
language sql security invoker set search_path='' as $$select private.append_message_reply_once(p_message_id,p_reply_id,p_text)$$;
revoke all on function private.append_message_reply_once(uuid,uuid,text),public.append_message_reply(uuid,uuid,text) from public,anon;
grant execute on function private.append_message_reply_once(uuid,uuid,text),public.append_message_reply(uuid,uuid,text) to authenticated;
commit;
