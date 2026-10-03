begin;

create unique index documents_one_fulfillment on public.documents(reference_id)
  where reference_id is not null and kind in ('sale','purchase');

create function private.validate_document_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_source public.documents%rowtype;
begin
  if new.reference_id is null or new.kind not in ('sale','purchase') then return new; end if;
  select * into v_source from public.documents where id = new.reference_id for update;
  if not found or v_source.status <> 'open' or
    (new.kind = 'sale' and v_source.kind not in ('quote','sales_order')) or
    (new.kind = 'purchase' and v_source.kind <> 'purchase_order') or
    v_source.party_id is distinct from new.party_id or v_source.warehouse_id <> new.warehouse_id then
    raise exception 'Fulfillment must match an open quotation or order';
  end if;
  if not private.is_admin() and v_source.created_by <> auth.uid() then
    raise exception 'Only the creator can fulfill this order';
  end if;
  return new;
end;
$$;
create trigger validate_document_reference before insert on public.documents
  for each row execute function private.validate_document_reference();

create or replace function public.post_document(p_kind text, p_party uuid, p_warehouse uuid, p_lines jsonb,
  p_discount numeric default 0, p_note text default '', p_reference uuid default null,
  p_paid numeric default 0, p_cash_account uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_line jsonb; v_lines jsonb := '[]'::jsonb; v_qty numeric; v_factor numeric;
  v_price numeric; v_discount numeric; v_unit text; v_product record;
begin
  if p_discount <> round(p_discount,2) or p_paid <> round(p_paid,2) then
    raise exception 'Money amounts must use cents';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Lines must be an array'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    v_unit := coalesce(v_line->>'unit','base');
    select * into v_product from public.catalog() where id = (v_line->>'product_id')::uuid;
    if not found then raise exception 'Product not found'; end if;
    v_factor := case when v_unit = 'alternate' then v_product.units_per_alternate else 1 end;
    if v_qty <> round(v_qty,3) or v_qty * v_factor <> round(v_qty * v_factor,3) then
      raise exception 'Quantity must resolve to thousandths of a base unit';
    end if;
    v_price := coalesce((v_line->>'unit_price')::numeric,
      round((case when p_kind in ('purchase','purchase_return','purchase_order')
        then v_product.cost_price else v_product.selling_price end) * v_factor,2));
    v_discount := coalesce((v_line->>'discount')::numeric,0);
    if v_price <> round(v_price,2) or v_discount <> round(v_discount,2) then
      raise exception 'Prices and discounts must use cents';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,'quantity',v_qty,'unit',v_unit,'unit_price',v_price,'discount',v_discount));
  end loop;
  return private.post_document(p_kind,p_party,p_warehouse,v_lines,p_discount,p_note,p_reference,p_paid,p_cash_account);
end;
$$;

create or replace function public.record_payment(p_party uuid, p_direction text, p_amount numeric, p_account uuid,
  p_document uuid default null, p_note text default '') returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  if p_amount <> round(p_amount,2) then raise exception 'Amount must use cents'; end if;
  return private.create_payment(p_party,p_direction,p_amount,p_account,p_document,p_note);
end;
$$;

create or replace function public.adjust_stock(p_product uuid, p_warehouse uuid, p_delta numeric,
  p_kind text, p_unit_cost numeric default null, p_note text default '') returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  if p_delta <> round(p_delta,3) or (p_unit_cost is not null and p_unit_cost <> round(p_unit_cost,2)) then
    raise exception 'Quantity or unit cost has too many decimal places';
  end if;
  return private.adjust_stock(p_product,p_warehouse,p_delta,p_kind,p_unit_cost,p_note);
end;
$$;

create or replace function public.record_expense(p_account uuid, p_cash_account uuid, p_description text, p_amount numeric)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if p_amount <> round(p_amount,2) then raise exception 'Amount must use cents'; end if;
  return private.record_expense(p_account,p_cash_account,p_description,p_amount);
end;
$$;

create or replace function public.pay_salary(p_staff uuid, p_period text, p_gross numeric, p_cash_account uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if p_gross <> round(p_gross,2) then raise exception 'Salary must use cents'; end if;
  return private.pay_salary(p_staff,p_period,p_gross,p_cash_account);
end;
$$;

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
      if v_net_total + v_tax_total > 0 then
        insert into public.journal_lines(entry_id, account_id, debit) values (v_entry, v_cash, v_net_total + v_tax_total);
      end if;
    else perform private.ledger_line(v_entry, 'receivable', v_net_total + v_tax_total, 0, p_party); end if;
    perform private.ledger_line(v_entry, 'sales', 0, v_net_total);
    perform private.ledger_line(v_entry, 'output_tax', 0, v_tax_total);
    perform private.ledger_line(v_entry, 'cogs', v_cost, 0);
    perform private.ledger_line(v_entry, 'inventory', 0, v_cost);
  elsif p_kind = 'sale_return' then
    perform private.ledger_line(v_entry, 'sales', v_net_total, 0);
    perform private.ledger_line(v_entry, 'output_tax', v_tax_total, 0);
    if p_party is null then
      if v_net_total + v_tax_total > 0 then
        insert into public.journal_lines(entry_id, account_id, credit) values (v_entry, v_cash, v_net_total + v_tax_total);
      end if;
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

commit;
