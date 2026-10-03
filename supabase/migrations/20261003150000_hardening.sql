begin;

create unique index document_lines_one_product on public.document_lines(document_id, product_id);

create function private.prevent_unit_redefinition() returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.base_unit, old.alternate_unit, old.units_per_alternate) is distinct from
    (new.base_unit, new.alternate_unit, new.units_per_alternate)
    and exists (select 1 from public.document_lines where product_id = old.id) then
    raise exception 'Units cannot change after a product appears on a document';
  end if;
  return new;
end;
$$;
create trigger products_units_locked before update on public.products
  for each row execute function private.prevent_unit_redefinition();

drop policy "staff read products" on public.products;
create policy "admins read products" on public.products for select to authenticated using ((select private.is_admin()));
drop policy "staff read parties" on public.parties;
create policy "staff read allowed parties" on public.parties for select to authenticated
  using ((select private.is_admin()) or ((select private.has_access()) and kind in ('customer','both')));
drop policy "staff read accounts" on public.accounts;
create policy "staff read cash accounts" on public.accounts for select to authenticated
  using ((select private.is_admin()) or ((select private.has_access()) and is_cash and active));
drop policy "staff read documents" on public.documents;
create policy "staff read allowed documents" on public.documents for select to authenticated
  using ((select private.is_admin()) or ((select private.has_access()) and created_by = (select auth.uid())
    and kind in ('sale','quote','sales_order')));
drop policy "staff read document lines" on public.document_lines;
create policy "staff read allowed document lines" on public.document_lines for select to authenticated
  using ((select private.is_admin()) or exists (
    select 1 from public.documents d where d.id = document_id and d.created_by = (select auth.uid())
      and d.kind in ('sale','quote','sales_order') and (select private.has_access())));
drop policy "staff read stock balances" on public.stock_balances;
create policy "admins read stock balances" on public.stock_balances for select to authenticated using ((select private.is_admin()));
drop policy "staff read stock movements" on public.stock_movements;
create policy "admins read stock movements" on public.stock_movements for select to authenticated using ((select private.is_admin()));
drop policy "staff read payments" on public.payments;
create policy "staff read allowed payments" on public.payments for select to authenticated
  using ((select private.is_admin()) or ((select private.has_access()) and created_by = (select auth.uid())));

create function private.catalog() returns table(id uuid, sku text, name text, base_unit text,
  alternate_unit text, units_per_alternate numeric, selling_price numeric, cost_price numeric,
  tax_rate numeric, reorder_level numeric, active boolean)
language sql stable security definer set search_path = '' as $$
  select p.id,p.sku,p.name,p.base_unit,p.alternate_unit,p.units_per_alternate,p.selling_price,
    case when private.is_admin() then p.cost_price else 0::numeric end,
    p.tax_rate,p.reorder_level,p.active from public.products p where private.has_access();
$$;
create function public.catalog() returns table(id uuid, sku text, name text, base_unit text,
  alternate_unit text, units_per_alternate numeric, selling_price numeric, cost_price numeric,
  tax_rate numeric, reorder_level numeric, active boolean)
language sql stable set search_path = '' as $$ select * from private.catalog(); $$;

create function private.stock_quantities() returns table(product_id uuid, warehouse_id uuid, quantity numeric, value numeric)
language sql stable security definer set search_path = '' as $$
  select b.product_id,b.warehouse_id,b.quantity,
    case when private.is_admin() then b.value else 0::numeric end
  from public.stock_balances b where private.has_access();
$$;
create function public.stock_quantities() returns table(product_id uuid, warehouse_id uuid, quantity numeric, value numeric)
language sql stable set search_path = '' as $$ select * from private.stock_quantities(); $$;

revoke all on function private.catalog(), private.stock_quantities(), public.catalog(), public.stock_quantities() from public, anon;
grant execute on function private.catalog(), private.stock_quantities(), public.catalog(), public.stock_quantities() to authenticated;

create or replace function private.post_document(p_kind text, p_party uuid, p_warehouse uuid, p_lines jsonb,
  p_discount numeric, p_note text, p_reference uuid, p_paid numeric, p_cash_account uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_entry uuid; v_status text; v_line jsonb; v_product public.products%rowtype;
  v_original public.documents%rowtype; v_source public.document_lines%rowtype;
  v_party_kind text; v_factor numeric; v_qty numeric; v_base_qty numeric;
  v_price numeric; v_line_discount numeric; v_gross numeric; v_subtotal numeric := 0; v_discount_used numeric := 0;
  v_allocated_discount numeric; v_net numeric; v_tax numeric; v_total numeric;
  v_net_total numeric := 0; v_tax_total numeric := 0; v_cost numeric := 0; v_move numeric;
  v_count integer; v_index integer := 0; v_unit text; v_returned numeric;
  v_return_discount numeric; v_return_tax numeric; v_cash uuid;
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
  if p_kind in ('sale_return','purchase_return') and p_discount <> 0 then
    raise exception 'Returns use the original discount';
  end if;
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
    select * into v_product from public.products where id = (v_line->>'product_id')::uuid
      and (active or p_kind in ('sale_return','purchase_return'));
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
    if p_kind in ('sale_return','purchase_return') then
      select * into v_source from public.document_lines where document_id = p_reference and product_id = v_product.id;
      if not found or v_source.unit_name <> (case when v_unit = 'alternate' then v_product.alternate_unit else v_product.base_unit end) then
        raise exception 'Return line must match the original product and unit';
      end if;
      select coalesce(sum(dl.quantity),0), coalesce(sum(dl.discount),0) into v_returned, v_return_discount
        from public.document_lines dl join public.documents d on d.id = dl.document_id
        where d.reference_id = p_reference and d.kind = p_kind and dl.product_id = v_product.id;
      if v_returned + v_qty > v_source.quantity then raise exception 'Return exceeds original quantity'; end if;
      v_price := v_source.unit_price;
      v_line_discount := case when v_returned + v_qty = v_source.quantity
        then v_source.discount - v_return_discount
        else round(v_source.discount * v_qty / v_source.quantity, 2) end;
    end if;
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
    if p_kind in ('sale_return','purchase_return') then
      select * into v_source from public.document_lines where document_id = p_reference and product_id = v_product.id;
      select coalesce(sum(dl.quantity),0), coalesce(sum(dl.discount),0), coalesce(sum(dl.tax),0)
        into v_returned, v_return_discount, v_return_tax
        from public.document_lines dl join public.documents d on d.id = dl.document_id
        where d.reference_id = p_reference and d.kind = p_kind and dl.product_id = v_product.id;
      if v_returned + v_qty > v_source.quantity then raise exception 'Return exceeds original quantity'; end if;
      v_price := v_source.unit_price;
      v_line_discount := case when v_returned + v_qty = v_source.quantity
        then v_source.discount - v_return_discount
        else round(v_source.discount * v_qty / v_source.quantity, 2) end;
    end if;
    v_gross := round(v_qty * v_price,2) - v_line_discount;
    v_allocated_discount := case when v_index = v_count then p_discount - v_discount_used
      when v_subtotal = 0 then 0 else round(p_discount * v_gross / v_subtotal,2) end;
    v_discount_used := v_discount_used + v_allocated_discount;
    v_net := v_gross - v_allocated_discount;
    v_tax := case when p_kind in ('sale_return','purchase_return') and v_returned + v_qty = v_source.quantity
      then v_source.tax - v_return_tax
      else round(v_net * case when p_kind in ('sale_return','purchase_return') then v_source.tax_rate else v_product.tax_rate end,2) end;
    v_total := v_net + v_tax;
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
        case when p_kind in ('sale_return','purchase_return') then v_source.tax_rate else v_product.tax_rate end,
        v_net, v_tax, v_total, abs(v_move));
    v_net_total := v_net_total + v_net;
    v_tax_total := v_tax_total + v_tax;
  end loop;
  update public.documents set subtotal = v_subtotal, tax_total = v_tax_total,
    total = v_net_total + v_tax_total where id = v_id;
  if v_status = 'open' then return v_id; end if;
  if p_kind = 'sale' and p_party is null then p_paid := v_net_total + v_tax_total; end if;
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


insert into public.accounts(code,name,type,system_key) values ('3000','Opening balance','equity','opening_equity');

create or replace function private.adjust_stock(p_product uuid, p_warehouse uuid, p_delta numeric,
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
    perform private.ledger_line(v_entry, case when p_kind = 'opening' then 'opening_equity' else 'variance' end, 0, v_value);
  elsif v_value < 0 then
    perform private.ledger_line(v_entry, 'variance', -v_value, 0);
    perform private.ledger_line(v_entry, 'inventory', 0, -v_value);
  end if;
  perform private.assert_balanced(v_entry);
  return v_id;
end;
$$;


commit;
