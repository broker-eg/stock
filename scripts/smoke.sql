-- Runs against the remote project in one transaction and leaves no test data.
begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.profiles where role = 'admin' limit 1), true);
set local role authenticated;

do $$
declare
  v_warehouse uuid; v_product uuid; v_supplier uuid; v_customer uuid; v_refund_supplier uuid; v_refund_customer uuid; v_cash uuid;
  v_sale uuid; v_purchase uuid; v_return uuid; v_cash_sale uuid; v_open uuid; v_paid_sale uuid;
  v_qty numeric; v_value numeric;
  v_count integer;
begin
  if not private.is_admin() then raise exception 'Smoke test requires an admin profile'; end if;
  insert into public.warehouses(name) values ('Smoke warehouse ' || gen_random_uuid()) returning id into v_warehouse;
  insert into public.products(sku,name,base_unit,alternate_unit,units_per_alternate,selling_price,cost_price,tax_rate)
    values ('SMOKE-' || gen_random_uuid(),'Smoke widget','piece','carton',10,20,10,0.1) returning id into v_product;
  insert into public.parties(kind,name) values ('supplier','Smoke supplier') returning id into v_supplier;
  insert into public.parties(kind,name) values ('customer','Smoke customer') returning id into v_customer;
  insert into public.parties(kind,name) values ('supplier','Smoke refund supplier') returning id into v_refund_supplier;
  insert into public.parties(kind,name) values ('customer','Smoke refund customer') returning id into v_refund_customer;
  select id into v_cash from public.accounts where system_key = 'cash';

  perform public.adjust_stock(v_product,v_warehouse,10,'opening',10,'Smoke opening stock');
  v_sale := public.post_document('sale',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',3,'unit','base','unit_price',20,'discount',0)),
    0,'Smoke sale',null,0,null);
  select quantity,value into v_qty,v_value from public.stock_balances where product_id=v_product and warehouse_id=v_warehouse;
  if v_qty <> 7 or v_value <> 70 then raise exception 'Sale stock mismatch: %, %',v_qty,v_value; end if;
  if (select total from public.documents where id=v_sale) <> 66 then raise exception 'Sale total mismatch'; end if;

  v_purchase := public.post_document('purchase',v_supplier,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','alternate','unit_price',100,'discount',0)),
    0,'Smoke purchase',null,0,null);
  select quantity,value into v_qty,v_value from public.stock_balances where product_id=v_product and warehouse_id=v_warehouse;
  if v_qty <> 17 or v_value <> 170 then raise exception 'Purchase stock mismatch: %, %',v_qty,v_value; end if;
  if (select total from public.documents where id=v_purchase) <> 110 then raise exception 'Purchase total mismatch'; end if;

  begin
    perform public.post_document('sale',v_customer,v_warehouse,
      jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',18,'unit','base','unit_price',20)),
      0,'Should fail',null,0,null);
    raise exception 'Oversell was accepted';
  exception when others then
    if sqlerrm = 'Oversell was accepted' then raise; end if;
  end;
  select quantity into v_qty from public.stock_balances where product_id=v_product and warehouse_id=v_warehouse;
  if v_qty <> 17 then raise exception 'Oversell changed stock'; end if;

  perform public.post_document('sale_return',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20,'discount',0)),
    0,'Smoke sales return',v_sale,0,null);
  perform public.post_document('purchase_return',v_supplier,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',0.2,'unit','alternate','unit_price',100,'discount',0)),
    0,'Smoke purchase return',v_purchase,0,null);
  select quantity,value into v_qty,v_value from public.stock_balances where product_id=v_product and warehouse_id=v_warehouse;
  if v_qty <> 16 or v_value <> 160 then raise exception 'Return stock mismatch: %, %',v_qty,v_value; end if;

  select count(*) into v_count from public.journal_entries je
    join public.journal_lines jl on jl.entry_id=je.id
    where je.source_id in (v_sale,v_purchase)
    group by je.id having sum(jl.debit)<>sum(jl.credit) limit 1;
  if v_count > 0 then raise exception 'Unbalanced journal'; end if;

  if not exists (select 1 from public.stock_balance_report(current_date,current_date,v_warehouse,'Africa/Cairo')
    where product_id=v_product and closing_quantity=16 and closing_value=160
      and received_quantity=21 and issued_quantity=5) then
    raise exception 'Stock report mismatch';
  end if;

  v_sale := public.post_document('sale',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2,'unit','base','unit_price',20,'discount',4)),
    2,'Discounted sale',null,0,null);
  if (select total from public.documents where id=v_sale) <> 37.40 then raise exception 'Discounted sale total mismatch'; end if;
  v_return := public.post_document('sale_return',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',999,'discount',0)),
    0,'First partial return',v_sale,0,null);
  if (select total from public.documents where id=v_return) <> 18.70 then raise exception 'First return did not inherit discount'; end if;
  v_return := public.post_document('sale_return',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',0,'discount',0)),
    0,'Final partial return',v_sale,0,null);
  if (select total from public.documents where id=v_return) <> 18.70 then raise exception 'Final return did not inherit discount'; end if;
  begin
    perform public.post_document('sale_return',v_customer,v_warehouse,
      jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20)),
      0,'Should fail',v_sale,0,null);
    raise exception 'Excess return was accepted';
  exception when others then
    if sqlerrm = 'Excess return was accepted' then raise; end if;
  end;

  v_cash_sale := public.post_document('sale',null,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',19.99,'discount',0.01)),
    0,'Cash sale',null,0,null);
  if (select total from public.documents where id=v_cash_sale) <> 21.98 then raise exception 'Cash sale total mismatch'; end if;
  perform public.post_document('sale',null,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',0,'discount',0)),
    0,'Zero-price sale',null,0,null);

  v_paid_sale := public.post_document('sale',v_refund_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20)),
    0,'Paid sale',null,22,v_cash);
  perform public.post_document('sale_return',v_refund_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20)),
    0,'Paid sale return',v_paid_sale,0,null);
  perform public.record_payment(v_refund_customer,'refund_customer',22,v_cash,null,'Customer refund');
  if (select coalesce(sum(case when direction='refund_customer' then amount else 0 end),0)
      from public.payments where party_id=v_refund_customer) <> 22 then raise exception 'Customer refund missing'; end if;

  v_purchase := public.post_document('purchase',v_refund_supplier,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',10)),
    0,'Paid purchase',null,11,v_cash);
  perform public.post_document('purchase_return',v_refund_supplier,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',10)),
    0,'Paid purchase return',v_purchase,0,null);
  perform public.record_payment(v_refund_supplier,'refund_supplier',11,v_cash,null,'Supplier refund');
  if (select coalesce(sum(case when direction='refund_supplier' then amount else 0 end),0)
      from public.payments where party_id=v_refund_supplier) <> 11 then raise exception 'Supplier refund missing'; end if;

  v_open := public.post_document('quote',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20)),
    0,'Mistaken quote',null,0,null);
  perform public.cancel_open_document(v_open);
  if not exists (select 1 from public.documents where id=v_open and status='cancelled'
    and cancelled_at is not null and cancelled_by=auth.uid()) then raise exception 'Quote cancellation audit missing'; end if;
  v_open := public.post_document('sales_order',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20)),
    0,'Order to fulfill',null,0,null);
  perform public.post_document('sale',v_customer,v_warehouse,
    jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit','base','unit_price',20)),
    0,'Order fulfillment',v_open,0,null);
  if (select status from public.documents where id=v_open) <> 'fulfilled' then raise exception 'Order not marked fulfilled'; end if;
end;
$$;

rollback;
