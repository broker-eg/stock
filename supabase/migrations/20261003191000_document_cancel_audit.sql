begin;

alter table public.documents
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id);

create or replace function public.cancel_open_document(p_document uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  update public.documents set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_document and status = 'open' and kind in ('quote','sales_order','purchase_order')
      and not exists (select 1 from public.documents posted where posted.reference_id = p_document
        and posted.kind in ('sale','purchase')) returning id into v_id;
  if v_id is null then raise exception 'Only an open document can be cancelled'; end if;
  return v_id;
end;
$$;

commit;
