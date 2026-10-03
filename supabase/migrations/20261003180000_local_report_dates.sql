begin;

create function public.stock_balance_report(p_from date, p_to date, p_warehouse uuid default null, p_timezone text default 'UTC')
returns table (product_id uuid, warehouse_id uuid, opening_quantity numeric, received_quantity numeric,
  issued_quantity numeric, closing_quantity numeric, closing_value numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, w.id,
    coalesce(sum(m.quantity_delta) filter (where m.occurred_at < (p_from::timestamp at time zone p_timezone)),0),
    coalesce(sum(m.quantity_delta) filter (where m.occurred_at >= (p_from::timestamp at time zone p_timezone)
      and m.occurred_at < ((p_to + 1)::timestamp at time zone p_timezone) and m.quantity_delta > 0),0),
    coalesce(-sum(m.quantity_delta) filter (where m.occurred_at >= (p_from::timestamp at time zone p_timezone)
      and m.occurred_at < ((p_to + 1)::timestamp at time zone p_timezone) and m.quantity_delta < 0),0),
    coalesce(sum(m.quantity_delta) filter (where m.occurred_at < ((p_to + 1)::timestamp at time zone p_timezone)),0),
    coalesce(sum(m.value_delta) filter (where m.occurred_at < ((p_to + 1)::timestamp at time zone p_timezone)),0)
  from public.products p cross join public.warehouses w
  left join public.stock_movements m on m.product_id = p.id and m.warehouse_id = w.id
  where (p_warehouse is null or w.id = p_warehouse) and private.has_access()
  group by p.id, w.id
  having coalesce(sum(m.quantity_delta) filter (where m.occurred_at < ((p_to + 1)::timestamp at time zone p_timezone)),0) <> 0
    or count(m.id) filter (where m.occurred_at >= (p_from::timestamp at time zone p_timezone) and m.occurred_at < ((p_to + 1)::timestamp at time zone p_timezone)) > 0;
$$;

revoke all on function public.stock_balance_report(date,date,uuid,text) from public, anon;
grant execute on function public.stock_balance_report(date,date,uuid,text) to authenticated;

commit;
