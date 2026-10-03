begin;

alter table public.payments drop constraint payments_direction_check;
alter table public.payments add constraint payments_direction_check
  check (direction in ('receipt', 'payment', 'refund_customer', 'refund_supplier'));

create or replace function private.create_payment(p_party uuid, p_direction text, p_amount numeric, p_account uuid,
  p_document uuid, p_note text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_entry uuid; v_kind text; v_balance numeric;
begin
  if not private.has_access() then raise exception 'Access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_direction not in ('receipt','payment','refund_customer','refund_supplier') then
    raise exception 'Invalid payment direction';
  end if;
  if p_direction in ('refund_customer','refund_supplier') and not private.is_admin() then
    raise exception 'Administrator access required';
  end if;
  select kind into v_kind from public.parties where id = p_party for update;
  if v_kind is null or (p_direction in ('receipt','refund_customer') and v_kind not in ('customer','both'))
    or (p_direction in ('payment','refund_supplier') and v_kind not in ('supplier','both')) then
    raise exception 'Party type does not match payment direction';
  end if;
  if not exists (select 1 from public.accounts where id = p_account and is_cash and active) then
    raise exception 'Choose an active cash or bank account';
  end if;
  if p_document is not null and not exists (
    select 1 from public.documents where id = p_document and party_id = p_party and status = 'posted'
  ) then raise exception 'Payment document does not match contact'; end if;

  if p_direction = 'refund_customer' then
    select coalesce(sum(case kind when 'sale' then total when 'sale_return' then -total else 0 end),0)
      into v_balance from public.documents where party_id = p_party and status = 'posted';
    select v_balance + coalesce(sum(case direction when 'receipt' then -amount
      when 'refund_customer' then amount else 0 end),0)
      into v_balance from public.payments where party_id = p_party;
    if v_balance >= 0 or p_amount > -v_balance then
      raise exception 'Refund exceeds customer credit';
    end if;
  elsif p_direction = 'refund_supplier' then
    select coalesce(sum(case kind when 'purchase' then total when 'purchase_return' then -total else 0 end),0)
      into v_balance from public.documents where party_id = p_party and status = 'posted';
    select v_balance + coalesce(sum(case direction when 'payment' then -amount
      when 'refund_supplier' then amount else 0 end),0)
      into v_balance from public.payments where party_id = p_party;
    if v_balance >= 0 or p_amount > -v_balance then
      raise exception 'Refund exceeds supplier credit';
    end if;
  end if;

  insert into public.payments(party_id, direction, amount, account_id, document_id, note, created_by)
    values (p_party, p_direction, p_amount, p_account, p_document, coalesce(p_note,''), auth.uid()) returning id into v_id;
  insert into public.journal_entries(source_type, source_id) values ('payment', v_id) returning id into v_entry;
  if p_direction = 'receipt' then
    insert into public.journal_lines(entry_id, account_id, debit) values (v_entry, p_account, p_amount);
    perform private.ledger_line(v_entry, 'receivable', 0, p_amount, p_party);
  elsif p_direction = 'payment' then
    perform private.ledger_line(v_entry, 'payable', p_amount, 0, p_party);
    insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, p_account, p_amount);
  elsif p_direction = 'refund_customer' then
    perform private.ledger_line(v_entry, 'receivable', p_amount, 0, p_party);
    insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, p_account, p_amount);
  else
    insert into public.journal_lines(entry_id, account_id, debit) values (v_entry, p_account, p_amount);
    perform private.ledger_line(v_entry, 'payable', 0, p_amount, p_party);
  end if;
  perform private.assert_balanced(v_entry);
  return v_id;
end;
$$;

alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('open', 'posted', 'fulfilled', 'cancelled'));

update public.documents source set status = 'fulfilled'
  where source.status = 'open' and exists (
    select 1 from public.documents posted where posted.reference_id = source.id
      and posted.kind in ('sale','purchase') and posted.status = 'posted'
  );

create function private.mark_document_fulfilled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reference_id is not null and new.kind in ('sale','purchase') then
    update public.documents set status = 'fulfilled' where id = new.reference_id and status = 'open';
  end if;
  return new;
end;
$$;
create trigger mark_document_fulfilled after insert on public.documents
  for each row execute function private.mark_document_fulfilled();

create function public.cancel_open_document(p_document uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  update public.documents set status = 'cancelled'
    where id = p_document and status = 'open' and kind in ('quote','sales_order','purchase_order')
      and not exists (select 1 from public.documents posted where posted.reference_id = p_document
        and posted.kind in ('sale','purchase')) returning id into v_id;
  if v_id is null then raise exception 'Only an open document can be cancelled'; end if;
  return v_id;
end;
$$;
revoke all on function public.cancel_open_document(uuid) from public, anon;
grant execute on function public.cancel_open_document(uuid) to authenticated;

commit;
