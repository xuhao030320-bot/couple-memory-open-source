-- 留言回复：在 messages 上追加 replies jsonb 数组。
-- 沿用 20260815_add_messages.sql 的安全设计：messages 表对客户端仍无 UPDATE 授权，
-- 追加回复走 security definer 的 RPC，服务端做成员校验与原子追加。
begin;

alter table public.messages
  add column replies jsonb not null default '[]'::jsonb;

create function public.append_message_reply(
  p_message_id uuid,
  p_reply_id uuid,
  p_text text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_couple_id uuid;
begin
  select couple_id into v_couple_id
  from public.messages
  where id = p_message_id;

  if v_couple_id is null then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;

  if not public.is_couple_member(v_couple_id) then
    raise exception 'NOT_A_MEMBER';
  end if;

  update public.messages
     set replies = replies || jsonb_build_object(
       'id', p_reply_id::text,
       'createdBy', (select auth.uid())::text,
       'text', left(trim(p_text), 500),
       'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     )
   where id = p_message_id;
end;
$$;

grant execute on function public.append_message_reply(uuid, uuid, text) to authenticated;

-- 表本身的 grant 不变（仍不给 authenticated 任何 update）。
-- messages 已在 supabase_realtime publication 中，UPDATE 事件会带出 replies 变化。

commit;
