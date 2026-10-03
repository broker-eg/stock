begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.business_settings (
  id integer primary key default 1 check (id = 1),
  name text not null default 'Dalamin Tech',
  tax_number text not null default '',
  currency text not null default 'USD',
  address text not null default '',
  phone text not null default '',
  logo_url text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.business_settings (id) values (1);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'cashier')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  base_unit text not null default 'piece',
  alternate_unit text,
  units_per_alternate numeric(18,3) check (units_per_alternate > 0),
  selling_price numeric(18,2) not null default 0 check (selling_price >= 0),
  cost_price numeric(18,2) not null default 0 check (cost_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 1),
  reorder_level numeric(18,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint alternate_unit_pair check ((alternate_unit is null) = (units_per_alternate is null))
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customer', 'supplier', 'both')),
  name text not null,
  phone text not null default '',
  email text not null default '',
  tax_number text not null default '',
  address text not null default '',
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'income', 'expense', 'equity')),
  is_cash boolean not null default false,
  system_key text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.accounts (code, name, type, is_cash, system_key) values
  ('1000', 'Cash', 'asset', true, 'cash'),
  ('1010', 'Bank', 'asset', true, 'bank'),
  ('1100', 'Accounts receivable', 'asset', false, 'receivable'),
  ('1200', 'Inventory', 'asset', false, 'inventory'),
  ('1300', 'Input tax', 'asset', false, 'input_tax'),
  ('2000', 'Accounts payable', 'liability', false, 'payable'),
  ('2100', 'Output tax', 'liability', false, 'output_tax'),
  ('4000', 'Sales revenue', 'income', false, 'sales'),
  ('5000', 'Cost of goods sold', 'expense', false, 'cogs'),
  ('5010', 'Purchase price variance', 'expense', false, 'variance'),
  ('6000', 'Operating expenses', 'expense', false, 'expenses'),
  ('6100', 'Salaries', 'expense', false, 'salaries');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  doc_number bigint generated always as identity unique,
  kind text not null check (kind in ('sale', 'sale_return', 'quote', 'sales_order', 'purchase', 'purchase_return', 'purchase_order')),
  status text not null check (status in ('open', 'posted')),
  party_id uuid references public.parties(id),
  warehouse_id uuid not null references public.warehouses(id),
  reference_id uuid references public.documents(id),
  subtotal numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  note text not null default '',
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index documents_occurred_idx on public.documents (occurred_at desc);
create index documents_party_idx on public.documents (party_id, occurred_at desc);

create table public.document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(18,3) not null check (quantity > 0),
  unit_name text not null,
  unit_factor numeric(18,3) not null check (unit_factor > 0),
  base_quantity numeric(18,3) not null check (base_quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  discount numeric(18,2) not null default 0 check (discount >= 0),
  tax_rate numeric(7,4) not null default 0,
  net numeric(18,2) not null,
  tax numeric(18,2) not null,
  total numeric(18,2) not null,
  cost_total numeric(18,2) not null default 0
);
create index document_lines_document_idx on public.document_lines (document_id);

create table public.stock_balances (
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity numeric(18,3) not null default 0 check (quantity >= 0),
  value numeric(18,2) not null default 0 check (value >= 0),
  primary key (product_id, warehouse_id)
);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity_delta numeric(18,3) not null check (quantity_delta <> 0),
  value_delta numeric(18,2) not null,
  kind text not null check (kind in ('opening', 'receipt', 'issue', 'damage', 'count', 'sale', 'sale_return', 'purchase', 'purchase_return')),
  document_id uuid references public.documents(id),
  note text not null default '',
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index stock_movements_report_idx on public.stock_movements (warehouse_id, product_id, occurred_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id),
  direction text not null check (direction in ('receipt', 'payment')),
  amount numeric(18,2) not null check (amount > 0),
  account_id uuid not null references public.accounts(id),
  document_id uuid references public.documents(id),
  note text not null default '',
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  cash_account_id uuid not null references public.accounts(id),
  description text not null,
  amount numeric(18,2) not null check (amount > 0),
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(user_id),
  day date not null,
  status text not null check (status in ('present', 'absent', 'leave')),
  note text not null default '',
  unique (staff_id, day)
);

create table public.payroll (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(user_id),
  period text not null,
  gross numeric(18,2) not null check (gross > 0),
  cash_account_id uuid not null references public.accounts(id),
  paid_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (staff_id, period)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  party_id uuid references public.parties(id),
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  check ((debit > 0) <> (credit > 0))
);

create function private.has_access() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and active);
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and role = 'admin' and active);
$$;
revoke all on function private.has_access() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.has_access(), private.is_admin() to authenticated;

alter table public.business_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.parties enable row level security;
alter table public.accounts enable row level security;
alter table public.documents enable row level security;
alter table public.document_lines enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.attendance enable row level security;
alter table public.payroll enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

create policy "staff read settings" on public.business_settings for select to authenticated using ((select private.has_access()));
create policy "admins edit settings" on public.business_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "staff read profiles" on public.profiles for select to authenticated using ((select private.is_admin()) or user_id = (select auth.uid()));
create policy "staff read warehouses" on public.warehouses for select to authenticated using ((select private.has_access()));
create policy "admins write warehouses" on public.warehouses for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "staff read products" on public.products for select to authenticated using ((select private.has_access()));
create policy "admins write products" on public.products for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "staff read parties" on public.parties for select to authenticated using ((select private.has_access()));
create policy "admins write parties" on public.parties for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "staff read accounts" on public.accounts for select to authenticated using ((select private.has_access()));
create policy "admins write accounts" on public.accounts for all to authenticated using ((select private.is_admin()) and system_key is null) with check ((select private.is_admin()) and system_key is null);

create policy "staff read documents" on public.documents for select to authenticated using ((select private.has_access()));
create policy "staff read document lines" on public.document_lines for select to authenticated using ((select private.has_access()));
create policy "staff read stock balances" on public.stock_balances for select to authenticated using ((select private.has_access()));
create policy "staff read stock movements" on public.stock_movements for select to authenticated using ((select private.has_access()));
create policy "staff read payments" on public.payments for select to authenticated using ((select private.has_access()));
create policy "admins read expenses" on public.expenses for select to authenticated using ((select private.is_admin()));
create policy "admins read attendance" on public.attendance for select to authenticated using ((select private.is_admin()));
create policy "admins write attendance" on public.attendance for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins read payroll" on public.payroll for select to authenticated using ((select private.is_admin()));
create policy "admins read journals" on public.journal_entries for select to authenticated using ((select private.is_admin()));
create policy "admins read journal lines" on public.journal_lines for select to authenticated using ((select private.is_admin()));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.business_settings, public.profiles, public.warehouses, public.products, public.parties, public.accounts,
  public.documents, public.document_lines, public.stock_balances, public.stock_movements, public.payments,
  public.expenses, public.attendance, public.payroll, public.journal_entries, public.journal_lines to authenticated;
grant update on public.business_settings to authenticated;
grant insert, update on public.warehouses, public.products, public.parties, public.accounts, public.attendance to authenticated;
create function private.account_id(p_key text) returns uuid language sql stable set search_path = '' as $$
  select id from public.accounts where system_key = p_key;
$$;

create function private.ledger_line(p_entry uuid, p_key text, p_debit numeric, p_credit numeric, p_party uuid default null)
returns void language plpgsql set search_path = '' as $$
begin
  if p_debit <> 0 or p_credit <> 0 then
    insert into public.journal_lines(entry_id, account_id, party_id, debit, credit)
    values (p_entry, private.account_id(p_key), p_party, p_debit, p_credit);
  end if;
end;
$$;

create function private.assert_balanced(p_entry uuid) returns void language plpgsql set search_path = '' as $$
declare v_difference numeric;
begin
  select coalesce(sum(debit-credit),0) into v_difference from public.journal_lines where entry_id = p_entry;
  if v_difference <> 0 then raise exception 'Journal entry is unbalanced by %', v_difference; end if;
end;
$$;

create function private.move_stock(p_product uuid, p_warehouse uuid, p_delta numeric, p_in_value numeric,
  p_kind text, p_document uuid, p_note text, p_actor uuid, p_movement uuid default null)
returns numeric language plpgsql set search_path = '' as $$
declare v_quantity numeric; v_value numeric; v_change numeric;
begin
  if p_delta = 0 then raise exception 'Stock change must be nonzero'; end if;
  insert into public.stock_balances(product_id, warehouse_id) values (p_product, p_warehouse) on conflict do nothing;
  select quantity, value into v_quantity, v_value from public.stock_balances
    where product_id = p_product and warehouse_id = p_warehouse for update;
  if p_delta < 0 then
    if v_quantity + p_delta < 0 then raise exception 'Insufficient stock for product %', p_product; end if;
    if v_quantity + p_delta = 0 then v_change := -v_value;
    else v_change := -round(v_value * (-p_delta) / v_quantity, 2); end if;
  else
    if p_in_value is null or p_in_value < 0 then raise exception 'Incoming stock value is required'; end if;
    v_change := round(p_in_value, 2);
  end if;
  update public.stock_balances set quantity = quantity + p_delta, value = value + v_change
    where product_id = p_product and warehouse_id = p_warehouse;
  insert into public.stock_movements(id, product_id, warehouse_id, quantity_delta, value_delta, kind, document_id, note, created_by)
    values (coalesce(p_movement, gen_random_uuid()), p_product, p_warehouse, p_delta, v_change, p_kind, p_document, coalesce(p_note,''), p_actor);
  return v_change;
end;
$$;

create function private.create_payment(p_party uuid, p_direction text, p_amount numeric, p_account uuid,
  p_document uuid, p_note text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_entry uuid; v_kind text;
begin
  if not private.has_access() then raise exception 'Access denied'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_direction not in ('receipt','payment') then raise exception 'Invalid payment direction'; end if;
  select kind into v_kind from public.parties where id = p_party;
  if v_kind is null or (p_direction = 'receipt' and v_kind not in ('customer','both'))
    or (p_direction = 'payment' and v_kind not in ('supplier','both')) then
    raise exception 'Party type does not match payment direction';
  end if;
  if not exists (select 1 from public.accounts where id = p_account and is_cash and active) then
    raise exception 'Choose an active cash or bank account';
  end if;
  insert into public.payments(party_id, direction, amount, account_id, document_id, note, created_by)
    values (p_party, p_direction, p_amount, p_account, p_document, coalesce(p_note,''), auth.uid()) returning id into v_id;
  insert into public.journal_entries(source_type, source_id) values ('payment', v_id) returning id into v_entry;
  if p_direction = 'receipt' then
    insert into public.journal_lines(entry_id, account_id, debit) values (v_entry, p_account, p_amount);
    perform private.ledger_line(v_entry, 'receivable', 0, p_amount, p_party);
  else
    perform private.ledger_line(v_entry, 'payable', p_amount, 0, p_party);
    insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, p_account, p_amount);
  end if;
  perform private.assert_balanced(v_entry);
  return v_id;
end;
$$;

create function public.record_payment(p_party uuid, p_direction text, p_amount numeric, p_account uuid,
  p_document uuid default null, p_note text default '') returns uuid language sql set search_path = '' as $$
  select private.create_payment(p_party, p_direction, p_amount, p_account, p_document, p_note);
$$;

create function private.post_document(p_kind text, p_party uuid, p_warehouse uuid, p_lines jsonb,
  p_discount numeric, p_note text, p_reference uuid, p_paid numeric, p_cash_account uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_entry uuid; v_status text; v_line jsonb; v_product public.products%rowtype;
  v_original public.documents%rowtype; v_party_kind text; v_factor numeric; v_qty numeric; v_base_qty numeric;
  v_price numeric; v_line_discount numeric; v_gross numeric; v_subtotal numeric := 0; v_discount_used numeric := 0;
  v_allocated_discount numeric; v_net numeric; v_tax numeric; v_total numeric;
  v_net_total numeric := 0; v_tax_total numeric := 0; v_cost numeric := 0; v_move numeric;
  v_count integer; v_index integer := 0; v_unit text; v_returned numeric; v_original_qty numeric;
  v_original_price numeric; v_cash uuid;
begin
  if not private.has_access() then raise exception 'Access denied'; end if;
  if p_kind not in ('sale','sale_return','quote','sales_order','purchase','purchase_return','purchase_order') then
    raise exception 'Unsupported document kind';
  end if;
  if p_kind in ('purchase','purchase_return','purchase_order','sale_return') and not private.is_admin() then
    raise exception 'Administrator access required';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and active) then
    raise exception 'Choose an active warehouse';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Lines must be an array'; end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 or v_count > 100 then raise exception 'A document needs 1 to 100 lines'; end if;
  if p_discount is null or p_discount < 0 then raise exception 'Discount cannot be negative'; end if;
  if p_paid is null or p_paid < 0 then raise exception 'Amount paid cannot be negative'; end if;
  if p_party is not null then
    select kind into v_party_kind from public.parties where id = p_party;
    if v_party_kind is null then raise exception 'Party not found'; end if;
    if p_kind in ('purchase','purchase_return','purchase_order') and v_party_kind not in ('supplier','both') then
      raise exception 'Choose a supplier';
    end if;
    if p_kind in ('sale','sale_return','quote','sales_order') and v_party_kind not in ('customer','both') then
      raise exception 'Choose a customer';
    end if;
  elsif p_kind in ('purchase','purchase_return','purchase_order') then
    raise exception 'Supplier is required';
  end if;
  if p_kind in ('sale_return','purchase_return') then
    select * into v_original from public.documents where id = p_reference for update;
    if not found or v_original.kind <> (case when p_kind = 'sale_return' then 'sale' else 'purchase' end)
      or v_original.warehouse_id <> p_warehouse or v_original.party_id is distinct from p_party then
      raise exception 'Return must reference a matching posted document';
    end if;
  elsif p_reference is not null and not exists (select 1 from public.documents where id = p_reference) then
    raise exception 'Reference document not found';
  end if;
  v_status := case when p_kind in ('quote','sales_order','purchase_order') then 'open' else 'posted' end;
  if v_status = 'open' and p_paid <> 0 then raise exception 'Cannot pay an open document'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid and active;
    if not found then raise exception 'Choose an active product'; end if;
    v_qty := (v_line->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    v_unit := coalesce(v_line->>'unit', 'base');
    if v_unit not in ('base','alternate') or (v_unit = 'alternate' and v_product.alternate_unit is null) then
      raise exception 'Invalid unit for product %', v_product.name;
    end if;
    v_factor := case when v_unit = 'alternate' then v_product.units_per_alternate else 1 end;
    v_price := coalesce((v_line->>'unit_price')::numeric,
      case when p_kind in ('purchase','purchase_return','purchase_order') then v_product.cost_price else v_product.selling_price end * v_factor);
    v_line_discount := coalesce((v_line->>'discount')::numeric, 0);
    if v_price < 0 or v_line_discount < 0 or v_line_discount > round(v_qty * v_price,2) then
      raise exception 'Invalid price or line discount';
    end if;
    v_subtotal := v_subtotal + round(v_qty * v_price,2) - v_line_discount;
  end loop;
  if p_discount > v_subtotal then raise exception 'Document discount exceeds subtotal'; end if;
  insert into public.documents(kind, status, party_id, warehouse_id, reference_id, discount, note, created_by)
    values (p_kind, v_status, p_party, p_warehouse, p_reference, p_discount, coalesce(p_note,''), auth.uid()) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit := coalesce(v_line->>'unit','base');
    v_factor := case when v_unit = 'alternate' then v_product.units_per_alternate else 1 end;
    v_base_qty := v_qty * v_factor;
    v_price := coalesce((v_line->>'unit_price')::numeric,
      case when p_kind in ('purchase','purchase_return','purchase_order') then v_product.cost_price else v_product.selling_price end * v_factor);
    v_line_discount := coalesce((v_line->>'discount')::numeric,0);
    v_gross := round(v_qty * v_price,2) - v_line_discount;
    v_allocated_discount := case when v_index = v_count then p_discount - v_discount_used
      when v_subtotal = 0 then 0 else round(p_discount * v_gross / v_subtotal,2) end;
    v_discount_used := v_discount_used + v_allocated_discount;
    v_net := v_gross - v_allocated_discount;
    v_tax := round(v_net * v_product.tax_rate,2);
    v_total := v_net + v_tax;
    if p_kind in ('sale_return','purchase_return') then
      select coalesce(sum(base_quantity),0), max(unit_price) into v_original_qty, v_original_price
        from public.document_lines where document_id = p_reference and product_id = v_product.id and unit_name =
          case when v_unit = 'alternate' then v_product.alternate_unit else v_product.base_unit end;
      select coalesce(sum(dl.base_quantity),0) into v_returned
        from public.document_lines dl join public.documents d on d.id = dl.document_id
        where d.reference_id = p_reference and d.kind = p_kind and dl.product_id = v_product.id;
      if v_original_qty = 0 or v_returned + v_base_qty > v_original_qty or v_price <> v_original_price then
        raise exception 'Return exceeds original quantity or price for %', v_product.name;
      end if;
    end if;
    v_move := 0;
    if v_status = 'posted' then
      if p_kind in ('sale','purchase_return') then
        v_move := private.move_stock(v_product.id, p_warehouse, -v_base_qty, null, p_kind, v_id, p_note, auth.uid());
      else
        v_move := private.move_stock(v_product.id, p_warehouse, v_base_qty,
          case when p_kind = 'sale_return' then
            coalesce((select round(sum(cost_total) * v_base_qty / nullif(sum(base_quantity),0),2)
              from public.document_lines where document_id = p_reference and product_id = v_product.id),0)
          else v_net end, p_kind, v_id, p_note, auth.uid());
      end if;
      v_cost := v_cost + abs(v_move);
    end if;
    insert into public.document_lines(document_id, product_id, quantity, unit_name, unit_factor,
      base_quantity, unit_price, discount, tax_rate, net, tax, total, cost_total)
      values (v_id, v_product.id, v_qty,
        case when v_unit = 'alternate' then v_product.alternate_unit else v_product.base_unit end,
        v_factor, v_base_qty, v_price, v_line_discount + v_allocated_discount,
        v_product.tax_rate, v_net, v_tax, v_total, abs(v_move));
    v_net_total := v_net_total + v_net;
    v_tax_total := v_tax_total + v_tax;
  end loop;
  update public.documents set subtotal = v_subtotal, tax_total = v_tax_total,
    total = v_net_total + v_tax_total where id = v_id;
  if v_status = 'open' then return v_id; end if;
  if p_paid > v_net_total + v_tax_total then raise exception 'Payment exceeds document total'; end if;
  v_cash := coalesce(p_cash_account, private.account_id('cash'));
  if p_paid > 0 or (p_kind = 'sale' and p_party is null) or (p_kind = 'sale_return' and p_party is null) then
    if not exists (select 1 from public.accounts where id = v_cash and is_cash and active) then
      raise exception 'Choose an active cash or bank account';
    end if;
  end if;
  if p_kind = 'sale' and p_party is null and p_paid <> v_net_total + v_tax_total then
    raise exception 'Cash sale must be paid in full';
  end if;
  if p_kind not in ('sale','purchase') and p_paid <> 0 then raise exception 'Payment is only allowed on new sales and purchases'; end if;
  insert into public.journal_entries(source_type, source_id) values ('document', v_id) returning id into v_entry;
  if p_kind = 'sale' then
    if p_party is null then
      insert into public.journal_lines(entry_id, account_id, debit) values (v_entry, v_cash, v_net_total + v_tax_total);
    else perform private.ledger_line(v_entry, 'receivable', v_net_total + v_tax_total, 0, p_party); end if;
    perform private.ledger_line(v_entry, 'sales', 0, v_net_total);
    perform private.ledger_line(v_entry, 'output_tax', 0, v_tax_total);
    perform private.ledger_line(v_entry, 'cogs', v_cost, 0);
    perform private.ledger_line(v_entry, 'inventory', 0, v_cost);
  elsif p_kind = 'sale_return' then
    perform private.ledger_line(v_entry, 'sales', v_net_total, 0);
    perform private.ledger_line(v_entry, 'output_tax', v_tax_total, 0);
    if p_party is null then
      insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, v_cash, v_net_total + v_tax_total);
    else perform private.ledger_line(v_entry, 'receivable', 0, v_net_total + v_tax_total, p_party); end if;
    perform private.ledger_line(v_entry, 'inventory', v_cost, 0);
    perform private.ledger_line(v_entry, 'cogs', 0, v_cost);
  elsif p_kind = 'purchase' then
    perform private.ledger_line(v_entry, 'inventory', v_cost, 0);
    perform private.ledger_line(v_entry, 'input_tax', v_tax_total, 0);
    perform private.ledger_line(v_entry, 'payable', 0, v_net_total + v_tax_total, p_party);
  else
    perform private.ledger_line(v_entry, 'payable', v_net_total + v_tax_total, 0, p_party);
    perform private.ledger_line(v_entry, 'inventory', 0, v_cost);
    perform private.ledger_line(v_entry, 'input_tax', 0, v_tax_total);
    if v_net_total > v_cost then perform private.ledger_line(v_entry, 'variance', 0, v_net_total-v_cost);
    elsif v_cost > v_net_total then perform private.ledger_line(v_entry, 'variance', v_cost-v_net_total, 0); end if;
  end if;
  perform private.assert_balanced(v_entry);
  if p_paid > 0 then
    perform private.create_payment(p_party, case when p_kind = 'sale' then 'receipt' else 'payment' end,
      p_paid, v_cash, v_id, 'Payment on document');
  end if;
  return v_id;
end;
$$;

create function public.post_document(p_kind text, p_party uuid, p_warehouse uuid, p_lines jsonb,
  p_discount numeric default 0, p_note text default '', p_reference uuid default null,
  p_paid numeric default 0, p_cash_account uuid default null)
returns uuid language sql set search_path = '' as $$
  select private.post_document(p_kind, p_party, p_warehouse, p_lines, p_discount, p_note, p_reference, p_paid, p_cash_account);
$$;
create function private.adjust_stock(p_product uuid, p_warehouse uuid, p_delta numeric,
  p_kind text, p_unit_cost numeric, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_value numeric; v_entry uuid;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  if p_kind not in ('opening','receipt','issue','damage','count') then raise exception 'Invalid stock adjustment'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Quantity change must be nonzero'; end if;
  if p_kind in ('opening','receipt') and p_delta < 0 then raise exception 'Use issue or count for reductions'; end if;
  if p_kind in ('issue','damage') and p_delta > 0 then raise exception 'Use receipt or count for additions'; end if;
  if p_delta > 0 and (p_unit_cost is null or p_unit_cost < 0) then raise exception 'Unit cost is required'; end if;
  if not exists (select 1 from public.products where id = p_product and active) or
    not exists (select 1 from public.warehouses where id = p_warehouse and active) then
    raise exception 'Choose an active product and warehouse';
  end if;
  v_id := gen_random_uuid();
  v_value := private.move_stock(p_product, p_warehouse, p_delta,
    case when p_delta > 0 then round(p_delta * p_unit_cost,2) else null end,
    p_kind, null, p_note, auth.uid(), v_id);
  insert into public.journal_entries(source_type, source_id) values ('stock', v_id) returning id into v_entry;
  if v_value > 0 then
    perform private.ledger_line(v_entry, 'inventory', v_value, 0);
    perform private.ledger_line(v_entry, 'variance', 0, v_value);
  elsif v_value < 0 then
    perform private.ledger_line(v_entry, 'variance', -v_value, 0);
    perform private.ledger_line(v_entry, 'inventory', 0, -v_value);
  end if;
  perform private.assert_balanced(v_entry);
  return v_id;
end;
$$;

create function public.adjust_stock(p_product uuid, p_warehouse uuid, p_delta numeric,
  p_kind text, p_unit_cost numeric default null, p_note text default '') returns uuid
language sql set search_path = '' as $$
  select private.adjust_stock(p_product, p_warehouse, p_delta, p_kind, p_unit_cost, p_note);
$$;

create function private.record_expense(p_account uuid, p_cash_account uuid, p_description text, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_entry uuid;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  if p_amount is null or p_amount <= 0 or length(trim(coalesce(p_description,''))) = 0 then
    raise exception 'Description and positive amount are required';
  end if;
  if not exists (select 1 from public.accounts where id = p_account and type = 'expense' and active) or
    not exists (select 1 from public.accounts where id = p_cash_account and is_cash and active) then
    raise exception 'Choose active expense and payment accounts';
  end if;
  insert into public.expenses(account_id, cash_account_id, description, amount, created_by)
    values (p_account, p_cash_account, trim(p_description), p_amount, auth.uid()) returning id into v_id;
  insert into public.journal_entries(source_type, source_id) values ('expense', v_id) returning id into v_entry;
  insert into public.journal_lines(entry_id, account_id, debit) values (v_entry, p_account, p_amount);
  insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, p_cash_account, p_amount);
  perform private.assert_balanced(v_entry);
  return v_id;
end;
$$;
create function public.record_expense(p_account uuid, p_cash_account uuid, p_description text, p_amount numeric)
returns uuid language sql set search_path = '' as $$
  select private.record_expense(p_account, p_cash_account, p_description, p_amount);
$$;

create function private.pay_salary(p_staff uuid, p_period text, p_gross numeric, p_cash_account uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_entry uuid;
begin
  if not private.is_admin() then raise exception 'Administrator access required'; end if;
  if p_gross is null or p_gross <= 0 or p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'Valid period and salary are required';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_staff and active) or
    not exists (select 1 from public.accounts where id = p_cash_account and is_cash and active) then
    raise exception 'Choose active staff and payment account';
  end if;
  insert into public.payroll(staff_id, period, gross, cash_account_id, created_by)
    values (p_staff, p_period, p_gross, p_cash_account, auth.uid()) returning id into v_id;
  insert into public.journal_entries(source_type, source_id) values ('payroll', v_id) returning id into v_entry;
  perform private.ledger_line(v_entry, 'salaries', p_gross, 0);
  insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, p_cash_account, p_gross);
  perform private.assert_balanced(v_entry);
  return v_id;
end;
$$;
create function public.pay_salary(p_staff uuid, p_period text, p_gross numeric, p_cash_account uuid)
returns uuid language sql set search_path = '' as $$
  select private.pay_salary(p_staff, p_period, p_gross, p_cash_account);
$$;

create function public.stock_balance_report(p_from date, p_to date, p_warehouse uuid default null)
returns table (product_id uuid, warehouse_id uuid, opening_quantity numeric, received_quantity numeric,
  issued_quantity numeric, closing_quantity numeric, closing_value numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, w.id,
    coalesce(sum(m.quantity_delta) filter (where m.occurred_at < p_from::timestamptz),0),
    coalesce(sum(m.quantity_delta) filter (where m.occurred_at >= p_from::timestamptz
      and m.occurred_at < (p_to + 1)::timestamptz and m.quantity_delta > 0),0),
    coalesce(-sum(m.quantity_delta) filter (where m.occurred_at >= p_from::timestamptz
      and m.occurred_at < (p_to + 1)::timestamptz and m.quantity_delta < 0),0),
    coalesce(sum(m.quantity_delta) filter (where m.occurred_at < (p_to + 1)::timestamptz),0),
    coalesce(sum(m.value_delta) filter (where m.occurred_at < (p_to + 1)::timestamptz),0)
  from public.products p cross join public.warehouses w
  left join public.stock_movements m on m.product_id = p.id and m.warehouse_id = w.id
  where (p_warehouse is null or w.id = p_warehouse) and private.has_access()
  group by p.id, w.id
  having coalesce(sum(m.quantity_delta) filter (where m.occurred_at < (p_to + 1)::timestamptz),0) <> 0
    or count(m.id) filter (where m.occurred_at >= p_from::timestamptz and m.occurred_at < (p_to + 1)::timestamptz) > 0;
$$;

revoke all on function private.account_id(text), private.ledger_line(uuid,text,numeric,numeric,uuid),
  private.assert_balanced(uuid), private.move_stock(uuid,uuid,numeric,numeric,text,uuid,text,uuid,uuid),
  private.create_payment(uuid,text,numeric,uuid,uuid,text),
  private.post_document(text,uuid,uuid,jsonb,numeric,text,uuid,numeric,uuid),
  private.adjust_stock(uuid,uuid,numeric,text,numeric,text),
  private.record_expense(uuid,uuid,text,numeric), private.pay_salary(uuid,text,numeric,uuid) from public, anon;
grant execute on function private.create_payment(uuid,text,numeric,uuid,uuid,text),
  private.post_document(text,uuid,uuid,jsonb,numeric,text,uuid,numeric,uuid),
  private.adjust_stock(uuid,uuid,numeric,text,numeric,text),
  private.record_expense(uuid,uuid,text,numeric), private.pay_salary(uuid,text,numeric,uuid) to authenticated;
revoke all on function public.record_payment(uuid,text,numeric,uuid,uuid,text),
  public.post_document(text,uuid,uuid,jsonb,numeric,text,uuid,numeric,uuid),
  public.adjust_stock(uuid,uuid,numeric,text,numeric,text),
  public.record_expense(uuid,uuid,text,numeric), public.pay_salary(uuid,text,numeric,uuid),
  public.stock_balance_report(date,date,uuid) from public, anon;
grant execute on function public.record_payment(uuid,text,numeric,uuid,uuid,text),
  public.post_document(text,uuid,uuid,jsonb,numeric,text,uuid,numeric,uuid),
  public.adjust_stock(uuid,uuid,numeric,text,numeric,text),
  public.record_expense(uuid,uuid,text,numeric), public.pay_salary(uuid,text,numeric,uuid),
  public.stock_balance_report(date,date,uuid) to authenticated;

commit;
