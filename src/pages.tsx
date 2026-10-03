import { useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  FileDown,
  Filter,
  Package,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Save,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { PageProps } from './App'
import {
  db,
  call,
  currency,
  customerBalance,
  date,
  exportCsv,
  localDay,
  monthKey,
  number,
  partyBalance,
  saveRow,
  supplierBalance,
  today,
  type Document,
  type DocumentLine,
  type Party,
  type Product,
  type Warehouse,
} from './lib/db'
import { Badge, Button, Card, Empty, Field, Heading, Modal, SearchInput } from './components/ui'
import { formatDate, localeTag, localizeError, t } from './i18n'

type TxMode = 'sale' | 'purchase'
type CartLine = {
  key: string
  product_id: string
  quantity: number
  unit: 'base' | 'alternate'
  unit_price: number
  discount: number
}
const createKey = () => Math.random().toString(36).slice(2)
const money = (value: number, props: PageProps) => currency(value, props.data.settings.currency)
const productName = (props: PageProps, id: string) =>
  props.data.products.find((p) => p.id === id)?.name || t('Unknown product')
const partyName = (props: PageProps, id: string | null) =>
  id
    ? props.data.parties.find((p) => p.id === id)?.name || t('Unknown contact')
    : t('Walk-in customer')
const whName = (props: PageProps, id: string) =>
  props.data.warehouses.find((w) => w.id === id)?.name || t('Warehouse')
const totalStock = (props: PageProps, productId: string) =>
  props.data.balances
    .filter((b) => b.product_id === productId)
    .reduce((s, b) => s + Number(b.quantity), 0)
const docLabel: Record<string, string> = {
  sale: 'Sale',
  sale_return: 'Sales return',
  quote: 'Quotation',
  sales_order: 'Sales order',
  purchase: 'Purchase',
  purchase_return: 'Purchase return',
  purchase_order: 'Purchase order',
}
const documentLabel = (kind: string) => t(docLabel[kind] || 'Document')
const accountLabel = (account: { name: string; system_key: string | null }) =>
  account.system_key ? t(account.name) : account.name
const accountName = (props: PageProps, id: string) => {
  const account = props.data.accounts.find((item) => item.id === id)
  return account ? accountLabel(account) : ''
}
const unitLabel = (unit: string | null | undefined) => (unit ? t(unit) : '')

const docPrefix: Record<string, string> = {
  sale: 'SAL',
  sale_return: 'SR',
  quote: 'QUO',
  sales_order: 'SO',
  purchase: 'PUR',
  purchase_return: 'PR',
  purchase_order: 'PO',
}
const docNo = (d: Document) =>
  `${docPrefix[d.kind] || 'DOC'}-${String(d.doc_number).padStart(5, '0')}`

function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone = 'teal',
}: {
  label: string
  value: string
  note: string
  icon: typeof Boxes
  tone?: string
}) {
  return (
    <Card className="metric-card">
      <div className={`metric-icon metric-${tone}`}>
        <Icon size={20} />
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </Card>
  )
}

function SalesChart({
  data,
  format,
}: {
  data: { name: string; sales: number }[]
  format: (value: number) => string
}) {
  const max = Math.max(1, ...data.map((d) => d.sales))
  const rtl = localeTag().startsWith('ar')
  const points = data.map((d, i) => ({
    x: rtl ? 550 - i * 103 : 35 + i * 103,
    y: 170 - (d.sales / max) * 135,
    ...d,
  }))
  const line = points.map((p) => `${p.x},${p.y}`).join(' ')
  const area = `${rtl ? 550 : 35},170 ${line} ${rtl ? 35 : 550},170`
  return (
    <svg
      className="sales-chart"
      viewBox="0 0 585 210"
      preserveAspectRatio="none"
      role="img"
      aria-label={t('Monthly sales trend')}
    >
      <defs>
        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#148a80" stopOpacity=".22" />
          <stop offset="100%" stopColor="#148a80" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1="35"
            x2="550"
            y1={170 - i * 34}
            y2={170 - i * 34}
            stroke="#e9eeea"
            strokeDasharray="3 5"
          />
          <text x="25" y={174 - i * 34} textAnchor="end" fill="#9aa59c" fontSize="10">
            {number((max * i) / 4)}
          </text>
        </g>
      ))}
      <polygon points={area} fill="url(#salesGradient)" />
      <polyline
        points={line}
        fill="none"
        stroke="#148a80"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p) => (
        <g key={p.name}>
          <circle cx={p.x} cy={p.y} r="4" fill="#148a80">
            <title>
              {p.name}: {format(p.sales)}
            </title>
          </circle>
          <text x={p.x} y="198" textAnchor="middle" fill="#929f95" fontSize="11">
            {p.name}
          </text>
        </g>
      ))}
    </svg>
  )
}

export function Dashboard(props: PageProps) {
  const { data } = props
  const postedSales = data.documents.filter((d) => d.kind === 'sale' && d.status === 'posted')
  const salesReturns = data.documents.filter((d) => d.kind === 'sale_return')
  const revenue =
    postedSales.reduce((s, d) => s + Number(d.total), 0) -
    salesReturns.reduce((s, d) => s + Number(d.total), 0)
  const stockValue = data.balances.reduce((s, b) => s + Number(b.value), 0)
  const customers = data.parties.filter((p) => p.kind !== 'supplier')
  const owed = customers.reduce((s, p) => s + Math.max(0, customerBalance(data, p)), 0)
  const low = data.products.filter(
    (p) =>
      p.active && Number(p.reorder_level) > 0 && totalStock(props, p.id) <= Number(p.reorder_level),
  )
  const trend = Array.from({ length: 6 }, (_, i) => {
    const dt = new Date()
    dt.setMonth(dt.getMonth() - 5 + i)
    const key = localDay(dt.toISOString()).slice(0, 7)
    return {
      name: formatDate(dt.toISOString(), { month: 'short' }),
      sales:
        postedSales
          .filter((d) => monthKey(d.occurred_at) === key)
          .reduce((s, d) => s + Number(d.total), 0) -
        salesReturns
          .filter((d) => monthKey(d.occurred_at) === key)
          .reduce((s, d) => s + Number(d.total), 0),
    }
  })
  return (
    <>
      <Heading
        title={t(
          new Date().getHours() < 12
            ? 'Good morning, {name}'
            : new Date().getHours() < 18
              ? 'Good afternoon, {name}'
              : 'Good evening, {name}',
          { name: props.profile.full_name.split(' ')[0] },
        )}
        subtitle={t('Here is what is happening across your business today.')}
        action={
          <Button onClick={() => props.navigate('pos')} icon={<Plus size={17} />}>
            {t('New sale')}
          </Button>
        }
      />
      <div className="welcome-strip">
        <div>
          <span className="eyebrow">{t('AT A GLANCE')}</span>
          <h2>{t('Your business, in focus.')}</h2>
          <p>{t('Orders, stock and money move together, so your numbers stay clear.')}</p>
        </div>
        <div className="welcome-art">
          <span className="art-bar a" />
          <span className="art-bar b" />
          <span className="art-bar c" />
          <span className="art-bar d" />
        </div>
      </div>
      <div className="metrics-grid">
        <Metric
          label={props.profile.role === 'admin' ? t('Net sales') : t('My sales')}
          value={money(revenue, props)}
          note={t('{count} completed sales', { count: postedSales.length })}
          icon={TrendingUp}
        />
        {props.profile.role === 'admin' ? (
          <>
            <Metric
              label={t('Inventory value')}
              value={money(stockValue, props)}
              note={t('{count} products in catalog', { count: data.products.length })}
              icon={Package}
              tone="blue"
            />
            <Metric
              label={t('Customer balances')}
              value={money(owed, props)}
              note={t('Amount customers owe')}
              icon={ArrowDownLeft}
              tone="amber"
            />
          </>
        ) : (
          <>
            <Metric
              label={t('Sales today')}
              value={String(postedSales.filter((d) => localDay(d.occurred_at) === today()).length)}
              note={t('Completed today')}
              icon={ReceiptText}
              tone="blue"
            />
            <Metric
              label={t('Products available')}
              value={String(data.products.filter((p) => p.active).length)}
              note={t('Ready to sell')}
              icon={Package}
              tone="amber"
            />
          </>
        )}
        <Metric
          label={t('Low stock')}
          value={String(low.length)}
          note={t('Products at or below reorder level')}
          icon={Boxes}
          tone="rose"
        />
      </div>
      <div className="dashboard-grid">
        <Card className="chart-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Sales trend')}</h2>
              <p>{t('Last six months')}</p>
            </div>
            <Badge tone="blue">{t('Monthly')}</Badge>
          </div>
          <div className="chart-wrap">
            {trend.some((point) => point.sales > 0) ? (
              <SalesChart
                data={trend}
                format={(value) => currency(value, data.settings.currency)}
              />
            ) : (
              <div className="chart-empty">
                <TrendingUp size={24} />
                <strong>{t('No sales to chart yet')}</strong>
                <span>{t('Your monthly trend will appear after the first sale.')}</span>
              </div>
            )}
          </div>
        </Card>
        <Card className="quick-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Quick actions')}</h2>
              <p>{t('Pick up where you left off')}</p>
            </div>
          </div>
          <button onClick={() => props.navigate('pos')}>
            <span className="quick-icon teal">
              <ShoppingBag size={19} />
            </span>
            <span>
              <strong>{t('Record a sale')}</strong>
              <small>{t('Sell and update stock instantly')}</small>
            </span>
            <ChevronRight size={17} />
          </button>
          {props.profile.role === 'admin' && (
            <>
              <button onClick={() => props.navigate('inventory')}>
                <span className="quick-icon blue">
                  <Boxes size={19} />
                </span>
                <span>
                  <strong>{t('Manage inventory')}</strong>
                  <small>{t('Products, warehouses and counts')}</small>
                </span>
                <ChevronRight size={17} />
              </button>
              <button onClick={() => props.navigate('purchases')}>
                <span className="quick-icon amber">
                  <ArrowDownLeft size={19} />
                </span>
                <span>
                  <strong>{t('Record a purchase')}</strong>
                  <small>{t('Receive stock from a supplier')}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            </>
          )}
        </Card>
      </div>
      <Card className="table-card">
        <div className="card-title-row">
          <div>
            <h2>{t('Recent activity')}</h2>
            <p>{t('Your latest documents')}</p>
          </div>
          <Button variant="ghost" onClick={() => props.navigate('reports')}>
            {t('View reports')} <ArrowRight size={16} />
          </Button>
        </div>
        {data.documents.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Document')}</th>
                  <th>{t('Contact')}</th>
                  <th>{t('Date')}</th>
                  <th>{t('Status')}</th>
                  <th className="align-right">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.slice(0, 6).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{docNo(d)}</strong>
                      <small>{documentLabel(d.kind)}</small>
                    </td>
                    <td>{partyName(props, d.party_id)}</td>
                    <td>{date(d.occurred_at)}</td>
                    <td>
                      <Badge tone={d.status === 'posted' ? 'green' : 'amber'}>{t(d.status)}</Badge>
                    </td>
                    <td className="align-right strong">{money(d.total, props)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={t('No activity yet')}
            description={t('Your first sale or purchase will appear here.')}
            action={() => props.navigate('pos')}
          />
        )}
      </Card>
    </>
  )
}

export function Inventory(props: PageProps) {
  const { data, run, busy } = props
  const [tab, setTab] = useState<'products' | 'warehouses' | 'movements'>('products')
  const [search, setSearch] = useState('')
  const [product, setProduct] = useState<Partial<Product> | null>(null)
  const [warehouse, setWarehouse] = useState<Partial<Warehouse> | null>(null)
  const [adjust, setAdjust] = useState<{
    product_id: string
    warehouse_id: string
    kind: string
    quantity: number
    unit_cost: number
    note: string
  } | null>(null)
  const countedBalance = adjust
    ? Number(
        data.balances.find(
          (b) => b.product_id === adjust.product_id && b.warehouse_id === adjust.warehouse_id,
        )?.quantity || 0,
      )
    : 0
  const stockProducts = data.products.filter((p) =>
    `${p.sku} ${p.name}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <>
      <Heading
        title={t('Inventory')}
        subtitle={t('Know what you have, where it is, and what it is worth.')}
        action={
          <Button
            onClick={() =>
              setProduct({
                base_unit: '',
                selling_price: 0,
                cost_price: 0,
                tax_rate: 0,
                reorder_level: 0,
                active: true,
              })
            }
            icon={<Plus size={17} />}
          >
            {t('Add product')}
          </Button>
        }
      />
      <div className="summary-row">
        <div>
          <span>{t('Total products')}</span>
          <strong>{data.products.length}</strong>
        </div>
        <div>
          <span>{t('Warehouses')}</span>
          <strong>{data.warehouses.length}</strong>
        </div>
        <div>
          <span>{t('On-hand value')}</span>
          <strong>
            {money(
              data.balances.reduce((s, b) => s + Number(b.value), 0),
              props,
            )}
          </strong>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>
          {t('Products')}
        </button>
        <button
          className={tab === 'warehouses' ? 'active' : ''}
          onClick={() => setTab('warehouses')}
        >
          {t('Warehouses')}
        </button>
        <button className={tab === 'movements' ? 'active' : ''} onClick={() => setTab('movements')}>
          {t('Stock history')}
        </button>
      </div>
      {tab === 'products' && (
        <Card className="table-card">
          <div className="table-toolbar">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('Search products or SKU')}
            />
            <Button
              variant="secondary"
              onClick={() =>
                setAdjust({
                  product_id: data.products[0]?.id || '',
                  warehouse_id: data.warehouses[0]?.id || '',
                  kind: 'opening',
                  quantity: 0,
                  unit_cost: 0,
                  note: '',
                })
              }
              icon={<Plus size={16} />}
              disabled={!data.products.length || !data.warehouses.length}
            >
              {t('Stock adjustment')}
            </Button>
          </div>
          {stockProducts.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('Product')}</th>
                    <th>{t('Unit')}</th>
                    <th className="align-right">{t('On hand')}</th>
                    <th className="align-right">{t('Sell price')}</th>
                    <th className="align-right">{t('Stock value')}</th>
                    <th>{t('Status')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stockProducts.map((p) => {
                    const qty = totalStock(props, p.id)
                    const value = data.balances
                      .filter((b) => b.product_id === p.id)
                      .reduce((s, b) => s + Number(b.value), 0)
                    return (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                        </td>
                        <td>
                          {unitLabel(p.base_unit)}
                          {p.alternate_unit && (
                            <small>
                              {number(p.units_per_alternate || 0)} {unitLabel(p.base_unit)} /{' '}
                              {unitLabel(p.alternate_unit)}
                            </small>
                          )}
                        </td>
                        <td className="align-right strong">{number(qty)}</td>
                        <td className="align-right">{money(p.selling_price, props)}</td>
                        <td className="align-right">{money(value, props)}</td>
                        <td>
                          <Badge
                            tone={
                              !p.active
                                ? 'neutral'
                                : qty <= Number(p.reorder_level) && Number(p.reorder_level) > 0
                                  ? 'amber'
                                  : 'green'
                            }
                          >
                            {!p.active
                              ? t('Inactive')
                              : qty <= Number(p.reorder_level) && Number(p.reorder_level) > 0
                                ? t('Low stock')
                                : t('In stock')}
                          </Badge>
                        </td>
                        <td className="align-right">
                          <button className="table-action" onClick={() => setProduct(p)}>
                            {t('Edit')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={t('Your catalog starts here')}
              description={t('Add a product, then record its opening stock.')}
              action={() =>
                setProduct({
                  base_unit: '',
                  selling_price: 0,
                  cost_price: 0,
                  tax_rate: 0,
                  reorder_level: 0,
                  active: true,
                })
              }
            />
          )}
        </Card>
      )}
      {tab === 'warehouses' && (
        <Card className="table-card">
          <div className="table-toolbar">
            <div>
              <h2>{t('Storage locations')}</h2>
              <p>{t('Keep stock separate by warehouse.')}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setWarehouse({ active: true })}
              icon={<Plus size={16} />}
            >
              {t('Add warehouse')}
            </Button>
          </div>
          {data.warehouses.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Location')}</th>
                    <th>{t('Products stocked')}</th>
                    <th>{t('Status')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.warehouses.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <strong>{w.name}</strong>
                      </td>
                      <td>{w.location || '—'}</td>
                      <td>
                        {
                          data.balances.filter(
                            (b) => b.warehouse_id === w.id && Number(b.quantity) > 0,
                          ).length
                        }
                      </td>
                      <td>
                        <Badge tone={w.active ? 'green' : 'neutral'}>
                          {w.active ? t('Active') : t('Inactive')}
                        </Badge>
                      </td>
                      <td className="align-right">
                        <button className="table-action" onClick={() => setWarehouse(w)}>
                          {t('Edit')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={t('No warehouses yet')}
              description={t('Add a location before recording stock.')}
              action={() => setWarehouse({ active: true })}
            />
          )}
        </Card>
      )}
      {tab === 'movements' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Stock history')}</h2>
              <p>{t('Every addition and reduction is recorded.')}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                setAdjust({
                  product_id: data.products[0]?.id || '',
                  warehouse_id: data.warehouses[0]?.id || '',
                  kind: 'opening',
                  quantity: 0,
                  unit_cost: 0,
                  note: '',
                })
              }
              disabled={!data.products.length || !data.warehouses.length}
            >
              {t('New adjustment')}
            </Button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Product')}</th>
                  <th>{t('Warehouse')}</th>
                  <th>{t('Reason')}</th>
                  <th className="align-right">{t('Quantity')}</th>
                  <th className="align-right">{t('Value change')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.movements]
                  .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                  .map((m) => (
                    <tr key={m.id}>
                      <td>{date(m.occurred_at)}</td>
                      <td>
                        <strong>{productName(props, m.product_id)}</strong>
                        <small>{m.note}</small>
                      </td>
                      <td>{whName(props, m.warehouse_id)}</td>
                      <td>
                        <Badge tone={Number(m.quantity_delta) > 0 ? 'green' : 'amber'}>
                          {t(m.kind)}
                        </Badge>
                      </td>
                      <td
                        className={`align-right strong ${Number(m.quantity_delta) > 0 ? 'positive' : 'negative'}`}
                      >
                        {Number(m.quantity_delta) > 0 ? '+' : ''}
                        {number(m.quantity_delta)}
                      </td>
                      <td className="align-right">{money(m.value_delta, props)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.movements.length && (
              <Empty
                title={t('No movements yet')}
                description={t(
                  'Stock changes will show here after opening stock, sales or purchases.',
                )}
              />
            )}
          </div>
        </Card>
      )}
      {product && (
        <Modal
          title={product.id ? t('Edit product') : t('Add product')}
          onClose={() => setProduct(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              const { id, ...values } = product
              try {
                await run(() => saveRow('products', values, id), t('Product saved'), ['products'])
                setProduct(null)
              } catch {}
            }}
          >
            <Field label={t('Product name')}>
              <input
                required
                value={product.name || ''}
                onChange={(e) => setProduct({ ...product, name: e.target.value })}
              />
            </Field>
            <Field label={t('SKU')}>
              <input
                required
                value={product.sku || ''}
                onChange={(e) => setProduct({ ...product, sku: e.target.value })}
              />
            </Field>
            <Field label={t('Base unit')}>
              <input
                required
                value={product.base_unit || ''}
                onChange={(e) => setProduct({ ...product, base_unit: e.target.value })}
                placeholder={t('piece')}
              />
            </Field>
            <Field label={t('Alternate unit')}>
              <input
                value={product.alternate_unit || ''}
                onChange={(e) =>
                  setProduct({
                    ...product,
                    alternate_unit: e.target.value || null,
                    units_per_alternate: e.target.value ? product.units_per_alternate || 1 : null,
                  })
                }
                placeholder={t('carton (optional)')}
              />
            </Field>
            {product.alternate_unit && (
              <Field
                label={t('Base units per {unit}', { unit: unitLabel(product.alternate_unit) })}
              >
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  required
                  value={product.units_per_alternate || ''}
                  onChange={(e) =>
                    setProduct({ ...product, units_per_alternate: Number(e.target.value) })
                  }
                />
              </Field>
            )}
            <Field label={t('Selling price per base unit')}>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={product.selling_price ?? 0}
                onChange={(e) => setProduct({ ...product, selling_price: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('Cost price per base unit')}>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={product.cost_price ?? 0}
                onChange={(e) => setProduct({ ...product, cost_price: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('Tax rate %')}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={Number(product.tax_rate || 0) * 100}
                onChange={(e) => setProduct({ ...product, tax_rate: Number(e.target.value) / 100 })}
              />
            </Field>
            <Field label={t('Reorder level')}>
              <input
                type="number"
                min="0"
                step="0.001"
                required
                value={product.reorder_level ?? 0}
                onChange={(e) => setProduct({ ...product, reorder_level: Number(e.target.value) })}
              />
            </Field>
            <label className="check-field">
              <input
                type="checkbox"
                checked={product.active ?? true}
                onChange={(e) => setProduct({ ...product, active: e.target.checked })}
              />{' '}
              {t('Active product')}
            </label>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setProduct(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Save product')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {warehouse && (
        <Modal
          title={warehouse.id ? t('Edit warehouse') : t('Add warehouse')}
          onClose={() => setWarehouse(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              const { id, ...values } = warehouse
              try {
                await run(() => saveRow('warehouses', values, id), t('Warehouse saved'), [
                  'warehouses',
                ])
                setWarehouse(null)
              } catch {}
            }}
          >
            <Field label={t('Warehouse name')}>
              <input
                required
                value={warehouse.name || ''}
                onChange={(e) => setWarehouse({ ...warehouse, name: e.target.value })}
              />
            </Field>
            <Field label={t('Location')}>
              <input
                value={warehouse.location || ''}
                onChange={(e) => setWarehouse({ ...warehouse, location: e.target.value })}
              />
            </Field>
            <label className="check-field">
              <input
                type="checkbox"
                checked={warehouse.active ?? true}
                onChange={(e) => setWarehouse({ ...warehouse, active: e.target.checked })}
              />{' '}
              {t('Active warehouse')}
            </label>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setWarehouse(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Save warehouse')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {adjust && (
        <Modal title={t('Record stock adjustment')} onClose={() => setAdjust(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              const delta =
                adjust.kind === 'count'
                  ? adjust.quantity - countedBalance
                  : ['issue', 'damage'].includes(adjust.kind)
                    ? -Math.abs(adjust.quantity)
                    : adjust.quantity
              try {
                await run(
                  () =>
                    call('adjust_stock', {
                      p_product: adjust.product_id,
                      p_warehouse: adjust.warehouse_id,
                      p_delta: delta,
                      p_kind: adjust.kind,
                      p_unit_cost: delta > 0 ? adjust.unit_cost : null,
                      p_note: adjust.note,
                    }),
                  t('Stock updated'),
                  ['balances', 'movements', 'journalLines'],
                )
                setAdjust(null)
              } catch {}
            }}
          >
            <Field label={t('Product')}>
              <select
                required
                value={adjust.product_id}
                onChange={(e) => {
                  const p = data.products.find((x) => x.id === e.target.value)
                  setAdjust({
                    ...adjust,
                    product_id: e.target.value,
                    unit_cost: Number(p?.cost_price || 0),
                    quantity:
                      adjust.kind === 'count'
                        ? Number(
                            data.balances.find(
                              (b) =>
                                b.product_id === e.target.value &&
                                b.warehouse_id === adjust.warehouse_id,
                            )?.quantity || 0,
                          )
                        : adjust.quantity,
                  })
                }}
              >
                <option value="">{t('Select product')}</option>
                {data.products
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('Warehouse')}>
              <select
                required
                value={adjust.warehouse_id}
                onChange={(e) =>
                  setAdjust({
                    ...adjust,
                    warehouse_id: e.target.value,
                    quantity:
                      adjust.kind === 'count'
                        ? Number(
                            data.balances.find(
                              (b) =>
                                b.product_id === adjust.product_id &&
                                b.warehouse_id === e.target.value,
                            )?.quantity || 0,
                          )
                        : adjust.quantity,
                  })
                }
              >
                <option value="">{t('Select warehouse')}</option>
                {data.warehouses
                  .filter((w) => w.active)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('Reason')}>
              <select
                value={adjust.kind}
                onChange={(e) =>
                  setAdjust({
                    ...adjust,
                    kind: e.target.value,
                    quantity: e.target.value === 'count' ? countedBalance : 0,
                  })
                }
              >
                {['opening', 'receipt', 'issue', 'damage', 'count'].map((k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                adjust.kind === 'count'
                  ? t('Physical count in base units')
                  : t('Quantity in base units')
              }
              hint={
                adjust.kind === 'count'
                  ? t('Current balance: {quantity}', { quantity: number(countedBalance) })
                  : undefined
              }
            >
              <input
                required
                type="number"
                step="0.001"
                value={adjust.quantity || ''}
                onChange={(e) => setAdjust({ ...adjust, quantity: Number(e.target.value) })}
              />
            </Field>
            {!['issue', 'damage'].includes(adjust.kind) && (
              <Field label={t('Unit cost for incoming stock')}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjust.unit_cost}
                  onChange={(e) => setAdjust({ ...adjust, unit_cost: Number(e.target.value) })}
                />
              </Field>
            )}
            <Field label={t('Note')}>
              <input
                value={adjust.note}
                onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
                placeholder={t('Why did stock change?')}
              />
            </Field>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setAdjust(null)}>
                {t('Cancel')}
              </Button>
              <Button
                type="submit"
                disabled={busy || (adjust.kind === 'count' && adjust.quantity === countedBalance)}
              >
                {t('Post adjustment')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

export function Transactions(props: PageProps & { mode: TxMode }) {
  const { data, mode, run, busy } = props
  const isSale = mode === 'sale'
  const kinds = isSale
    ? ['sale', 'quote', 'sales_order', 'sale_return']
    : ['purchase', 'purchase_order', 'purchase_return']
  const [kind, setKind] = useState(isSale ? 'sale' : 'purchase')
  const [warehouse, setWarehouse] = useState(data.warehouses.find((w) => w.active)?.id || '')
  const [party, setParty] = useState('')
  const [reference, setReference] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState(0)
  const [cashAccount, setCashAccount] = useState(
    data.accounts.find((a) => a.system_key === 'cash')?.id || '',
  )
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState('')
  const [invoiceFormat, setInvoiceFormat] = useState(false)
  const [view, setView] = useState('')
  const [listOnly, setListOnly] = useState(false)
  const docs = data.documents.filter((d) =>
    isSale
      ? ['sale', 'quote', 'sales_order', 'sale_return'].includes(d.kind)
      : ['purchase', 'purchase_order', 'purchase_return'].includes(d.kind),
  )
  const originalDocs = data.documents.filter(
    (d) => d.kind === (isSale ? 'sale' : 'purchase') && d.status === 'posted',
  )
  const selectedReference = originalDocs.find((d) => d.id === reference)
  const isReturn = kind.endsWith('_return')
  const isOpen = ['quote', 'sales_order', 'purchase_order'].includes(kind)
  const validParties = data.parties.filter((p) =>
    isSale ? p.kind !== 'supplier' : p.kind !== 'customer',
  )
  const activeProducts = data.products.filter(
    (p) => p.active && `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()),
  )
  const subtotal = cart.reduce(
    (s, line) => s + Math.max(0, line.quantity * line.unit_price - line.discount),
    0,
  )
  const tax = cart.reduce((s, line) => {
    const p = data.products.find((x) => x.id === line.product_id)
    const gross = Math.max(0, line.quantity * line.unit_price - line.discount)
    const share = subtotal ? (discount * gross) / subtotal : 0
    const source = selectedReference?.document_lines.find((l) => l.product_id === line.product_id)
    return (
      s +
      Math.round(
        Math.max(0, gross - share) *
          Number(isReturn ? source?.tax_rate || 0 : p?.tax_rate || 0) *
          100,
      ) /
        100
    )
  }, 0)
  const total = Math.max(0, subtotal - discount + tax)
  function changeKind(next: string) {
    setKind(next)
    setCart([])
    setReference('')
    setDiscount(0)
    setPaid(0)
  }
  function addProduct(p: Product) {
    const existing = cart.find((c) => c.product_id === p.id)
    if (existing)
      setCart(cart.map((c) => (c.key === existing.key ? { ...c, quantity: c.quantity + 1 } : c)))
    else
      setCart([
        ...cart,
        {
          key: createKey(),
          product_id: p.id,
          quantity: 1,
          unit: 'base',
          unit_price: Number(isSale ? p.selling_price : p.cost_price),
          discount: 0,
        },
      ])
  }
  function changeLine(key: string, values: Partial<CartLine>) {
    setCart(
      cart.map((c) => {
        if (c.key !== key) return c
        const original = selectedReference?.document_lines.find(
          (l) => l.product_id === c.product_id,
        )
        const proportional =
          isReturn && values.quantity !== undefined && original
            ? {
                discount:
                  Math.round(
                    ((Number(original.discount) * Number(values.quantity)) /
                      Number(original.quantity)) *
                      100,
                  ) / 100,
              }
            : {}
        return { ...c, ...values, ...proportional }
      }),
    )
  }
  function remainingFor(doc: Document, line: DocumentLine) {
    const returned = data.documents
      .filter(
        (d) => d.reference_id === doc.id && d.kind === (isSale ? 'sale_return' : 'purchase_return'),
      )
      .flatMap((d) => d.document_lines)
      .filter((item) => item.product_id === line.product_id)
      .reduce((sum, item) => sum + Number(item.quantity), 0)
    return Math.max(0, Number(line.quantity) - returned)
  }
  function chooseReference(id: string) {
    setReference(id)
    const doc = originalDocs.find((d) => d.id === id)
    setWarehouse(doc?.warehouse_id || warehouse)
    setParty(doc?.party_id || '')
    setCart(
      doc?.document_lines
        .map((l) => {
          const remaining = remainingFor(doc, l)
          return {
            key: createKey(),
            product_id: l.product_id,
            quantity: remaining,
            unit:
              l.unit_name === data.products.find((p) => p.id === l.product_id)?.base_unit
                ? ('base' as const)
                : ('alternate' as const),
            unit_price: Number(l.unit_price),
            discount:
              Math.round(((Number(l.discount) * remaining) / Number(l.quantity)) * 100) / 100,
          }
        })
        .filter((l) => l.quantity > 0) || [],
    )
  }
  async function submit() {
    if (!warehouse || !cart.length) return
    try {
      const id = await run(
        () =>
          call<string>('post_document', {
            p_kind: kind,
            p_party: party || null,
            p_warehouse: warehouse,
            p_lines: cart.map((c) => ({
              product_id: c.product_id,
              quantity: Number(c.quantity),
              unit: c.unit,
              unit_price: Number(c.unit_price),
              discount: Number(c.discount),
            })),
            p_discount: Number(discount),
            p_note: note,
            p_reference: reference || null,
            p_paid:
              !isOpen && !isReturn
                ? isSale && !party
                  ? Number(total.toFixed(2))
                  : Number(paid)
                : 0,
            p_cash_account: cashAccount || null,
          }),
        t('{document} saved', { document: documentLabel(kind) }),
        ['documents', 'balances', 'movements', 'payments', 'journalLines'],
      )
      setReceipt(String(id))
      setCart([])
      setDiscount(0)
      setPaid(0)
      setNote('')
      setReference('')
    } catch {}
  }
  const selectedDoc = data.documents.find((d) => d.id === (receipt || view))
  return (
    <>
      <Heading
        title={isSale ? t('Point of sale') : t('Purchasing')}
        subtitle={
          isSale
            ? t('A simple checkout, with stock and accounts updated together.')
            : t('Order, receive, and return stock with a clear supplier trail.')
        }
        action={
          <div className="segmented">
            <button className={!listOnly ? 'active' : ''} onClick={() => setListOnly(false)}>
              {t('Create')}
            </button>
            <button className={listOnly ? 'active' : ''} onClick={() => setListOnly(true)}>
              {t('History')}
            </button>
          </div>
        }
      />
      {!listOnly ? (
        <>
          <div className="transaction-top">
            <div className="kind-tabs">
              {kinds.map((k) => (
                <button
                  key={k}
                  className={kind === k ? 'active' : ''}
                  onClick={() => changeKind(k)}
                >
                  {documentLabel(k)}
                </button>
              ))}
            </div>
            <div className="inline-field">
              <span>{t('Warehouse')}</span>
              <select
                value={warehouse}
                disabled={isReturn}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                <option value="">{t('Select warehouse')}</option>
                {data.warehouses
                  .filter((w) => w.active)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {isReturn && (
            <Card className="return-guide">
              <RotateCcw size={21} />
              <div>
                <strong>{t('Return against an original document')}</strong>
                <p>
                  {t(
                    'Select the original, then set the quantities being returned. Stock and the contact balance will reverse together.',
                  )}
                </p>
              </div>
              <select value={reference} onChange={(e) => chooseReference(e.target.value)}>
                <option value="">
                  {isSale ? t('Select original sale') : t('Select original purchase')}
                </option>
                {originalDocs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {docNo(d)} · {date(d.occurred_at)} · {money(d.total, props)}
                  </option>
                ))}
              </select>
            </Card>
          )}
          <div className="transaction-grid">
            <Card className="product-picker">
              <div className="card-title-row">
                <div>
                  <h2>{isReturn ? t('Original items') : t('Choose products')}</h2>
                  <p>
                    {isReturn
                      ? t('Edit quantities in the order panel.')
                      : t('Select items to add them to the order.')}
                  </p>
                </div>
                <Badge tone="blue">
                  {data.products.filter((p) => p.active).length} {t('products')}
                </Badge>
              </div>
              {!isReturn && (
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t('Search name or SKU')}
                />
              )}
              {isReturn ? (
                <div className="return-product-list">
                  {selectedReference?.document_lines.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      disabled={
                        cart.some((item) => item.product_id === l.product_id) ||
                        remainingFor(selectedReference, l) <= 0
                      }
                      onClick={() => {
                        const remaining = remainingFor(selectedReference, l)
                        setCart((current) => [
                          ...current,
                          {
                            key: createKey(),
                            product_id: l.product_id,
                            quantity: remaining,
                            unit:
                              l.unit_name ===
                              data.products.find((p) => p.id === l.product_id)?.base_unit
                                ? 'base'
                                : 'alternate',
                            unit_price: Number(l.unit_price),
                            discount:
                              Math.round(
                                ((Number(l.discount) * remaining) / Number(l.quantity)) * 100,
                              ) / 100,
                          },
                        ])
                      }}
                    >
                      <div className="product-tile-icon">
                        <Package size={19} />
                      </div>
                      <div>
                        <strong>{productName(props, l.product_id)}</strong>
                        <small>
                          {t('Originally')} {number(l.quantity)} {unitLabel(l.unit_name)}
                        </small>
                      </div>
                    </button>
                  ))}
                  {!selectedReference && (
                    <Empty
                      title={t('Choose an original document')}
                      description={t('The original items will appear here.')}
                    />
                  )}
                </div>
              ) : activeProducts.length ? (
                <div className="product-grid">
                  {activeProducts.map((p) => (
                    <button className="product-tile" key={p.id} onClick={() => addProduct(p)}>
                      <div className="product-tile-icon">
                        <Package size={20} />
                      </div>
                      <strong>{p.name}</strong>
                      <small>{p.sku}</small>
                      <div>
                        <span>
                          {money(isSale ? p.selling_price : p.cost_price, props)} /{' '}
                          {unitLabel(p.base_unit)}
                        </span>
                        <span className="stock-chip">
                          {number(totalStock(props, p.id))} {t('in stock')}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  title={t('No products found')}
                  description={
                    data.products.length
                      ? t('Try another search.')
                      : t('Add a product in Inventory first.')
                  }
                  action={() => props.navigate('inventory')}
                />
              )}
            </Card>
            <Card className="order-panel">
              <div className="order-head">
                <div>
                  <span className="eyebrow">{t('CURRENT DOCUMENT')}</span>
                  <h2>{documentLabel(kind)}</h2>
                </div>
                <div className="order-count">
                  {cart.length} {t('items')}
                </div>
              </div>
              <div className="order-meta">
                <Field label={isSale ? t('Customer') : t('Supplier')}>
                  <select
                    value={party}
                    disabled={isReturn}
                    onChange={(e) => setParty(e.target.value)}
                  >
                    <option value="">
                      {isSale ? t('Walk-in customer') : t('Select supplier')}
                    </option>
                    {validParties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="cart-list">
                {cart.length ? (
                  cart.map((line) => {
                    const p = data.products.find((x) => x.id === line.product_id)
                    const originalLine = selectedReference?.document_lines.find(
                      (item) => item.product_id === line.product_id,
                    )
                    return (
                      <div className="cart-item" key={line.key}>
                        <div className="cart-item-title">
                          <strong>{p?.name || t('Product')}</strong>
                          <button
                            onClick={() => setCart(cart.filter((c) => c.key !== line.key))}
                            aria-label={t('Remove')}
                          >
                            ×
                          </button>
                        </div>
                        <div className="cart-inputs">
                          <label>
                            {t('Qty')}
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={line.quantity}
                              max={isReturn && selectedReference && originalLine ? remainingFor(selectedReference, originalLine) : undefined}
                              onChange={(e) =>
                                changeLine(line.key, { quantity: Number(e.target.value) })
                              }
                            />
                          </label>
                          <label>
                            {t('Unit')}
                            <select
                              value={line.unit}
                              disabled={isReturn}
                              onChange={(e) => {
                                const unit = e.target.value as 'base' | 'alternate'
                                const factor =
                                  unit === 'alternate' ? Number(p?.units_per_alternate || 1) : 1
                                changeLine(line.key, {
                                  unit,
                                  unit_price:
                                    Math.round(
                                      Number(isSale ? p?.selling_price : p?.cost_price || 0) *
                                        factor *
                                        100,
                                    ) / 100,
                                })
                              }}
                            >
                              <option value="base">{unitLabel(p?.base_unit)}</option>
                              {p?.alternate_unit && (
                                <option value="alternate">{unitLabel(p.alternate_unit)}</option>
                              )}
                            </select>
                          </label>
                          <label>
                            {t('Price')}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unit_price}
                              disabled={isReturn}
                              onChange={(e) =>
                                changeLine(line.key, { unit_price: Number(e.target.value) })
                              }
                            />
                          </label>
                          <label>
                            {t('Discount')}
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.discount}
                              disabled={isReturn}
                              onChange={(e) =>
                                changeLine(line.key, { discount: Number(e.target.value) })
                              }
                            />
                          </label>
                        </div>
                        <div className="cart-line-total">
                          {money(
                            Math.max(0, line.quantity * line.unit_price - line.discount),
                            props,
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="cart-empty">
                    <ShoppingBag size={25} />
                    <strong>{t('Your order is empty')}</strong>
                    <span>{t('Pick a product to get started.')}</span>
                  </div>
                )}
              </div>
              <div className="order-bottom">
                <div className="order-detail">
                  <span>{t('Subtotal')}</span>
                  <strong>{money(subtotal, props)}</strong>
                </div>
                <div className="order-detail">
                  <span>{t('Order discount')}</span>
                  <input
                    className="mini-input"
                    type="number"
                    min="0"
                    max={subtotal}
                    step="0.01"
                    value={discount}
                    disabled={isReturn}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                  />
                </div>
                <div className="order-detail">
                  <span>{t('Tax')}</span>
                  <strong>{money(tax, props)}</strong>
                </div>
                <div className="order-total">
                  <span>{t('Total')}</span>
                  <strong>{money(total, props)}</strong>
                </div>
                {!isOpen && !isReturn && (
                  <div className="payment-fields">
                    {(party || !isSale) && (
                      <Field label={t('Paid now')}>
                        <input
                          type="number"
                          min="0"
                          max={total}
                          step="0.01"
                          value={paid}
                          onChange={(e) => setPaid(Number(e.target.value))}
                        />
                      </Field>
                    )}
                    {(Number(paid) > 0 || (isSale && !party)) && (
                      <Field label={t('Into account')}>
                        <select
                          value={cashAccount}
                          onChange={(e) => setCashAccount(e.target.value)}
                        >
                          {data.accounts
                            .filter((a) => a.is_cash && a.active)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {accountLabel(a)}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                  </div>
                )}
                {!isOpen && !isReturn && isSale && !party && (
                  <div className="cash-caption">
                    <Check size={15} /> {t('Walk-in sale is paid in full')}
                  </div>
                )}
                <Field label={t('Note (optional)')}>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('Add a note')}
                  />
                </Field>
                <Button
                  onClick={submit}
                  disabled={
                    busy ||
                    !cart.length ||
                    !warehouse ||
                    (!isSale && !party) ||
                    (isReturn && !reference) ||
                    discount > subtotal ||
                    cart.some((c) => c.quantity <= 0 || c.discount > c.quantity * c.unit_price)
                  }
                  className="full-width"
                  icon={<Check size={18} />}
                >
                  {busy
                    ? t('Saving…')
                    : isOpen
                      ? t('Save document')
                      : isReturn
                        ? t('Post return')
                        : isSale
                          ? t('Complete sale')
                          : t('Receive purchase')}
                </Button>
              </div>
            </Card>
          </div>
        </>
      ) : (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{isSale ? t('Sales documents') : t('Purchasing documents')}</h2>
              <p>{t('A full history of orders, invoices and returns.')}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setListOnly(false)}
              icon={<Plus size={16} />}
            >
              {t('New document')}
            </Button>
          </div>
          {docs.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('Document')}</th>
                    <th>{t('Contact')}</th>
                    <th>{t('Date')}</th>
                    <th>{t('Warehouse')}</th>
                    <th>{t('Status')}</th>
                    <th className="align-right">{t('Total')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{docNo(d)}</strong>
                        <small>{documentLabel(d.kind)}</small>
                      </td>
                      <td>{partyName(props, d.party_id)}</td>
                      <td>{date(d.occurred_at)}</td>
                      <td>{whName(props, d.warehouse_id)}</td>
                      <td>
                        <Badge
                          tone={
                            d.status === 'posted'
                              ? 'green'
                              : d.status === 'fulfilled'
                                ? 'blue'
                                : d.status === 'cancelled'
                                  ? 'neutral'
                                  : 'amber'
                          }
                        >
                          {t(d.status)}
                        </Badge>
                      </td>
                      <td className="align-right strong">{money(d.total, props)}</td>
                      <td>
                        <button className="table-action" onClick={() => setView(d.id)}>
                          {t('View')}
                        </button>
                        {d.status === 'open' && (
                          <button
                            className="table-action"
                            onClick={() => {
                              setKind(isSale ? 'sale' : 'purchase')
                              setReference(d.id)
                              setWarehouse(d.warehouse_id)
                              setParty(d.party_id || '')
                              setCart(
                                d.document_lines.map((l) => ({
                                  key: createKey(),
                                  product_id: l.product_id,
                                  quantity: Number(l.quantity),
                                  unit:
                                    l.unit_name ===
                                    data.products.find((p) => p.id === l.product_id)?.base_unit
                                      ? 'base'
                                      : 'alternate',
                                  unit_price: Number(l.unit_price),
                                  discount: Number(l.discount),
                                })),
                              )
                              setListOnly(false)
                            }}
                          >
                            {t('Fulfill')}
                          </button>
                        )}
                        {d.status === 'open' && props.profile.role === 'admin' && (
                          <button
                            className="table-action"
                            disabled={busy}
                            onClick={async () => {
                              if (!window.confirm(t('Cancel this open document?'))) return
                              try {
                                await run(
                                  () => call('cancel_open_document', { p_document: d.id }),
                                  t('Document cancelled'),
                                  ['documents'],
                                )
                              } catch {}
                            }}
                          >
                            {t('Cancel document')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={t('No documents yet')}
              description={t('Start with your first transaction.')}
              action={() => setListOnly(false)}
            />
          )}
        </Card>
      )}
      {selectedDoc && (
        <Modal
          title={receipt ? t('Document saved') : t('Document details')}
          width="wide"
          onClose={() => {
            setReceipt('')
            setView('')
            setInvoiceFormat(false)
          }}
        >
          <div className="receipt" id="print-receipt">
            <div className="receipt-header">
              <div>
                <div className="receipt-brand">
                  {data.settings.logo_url ? (
                    <img src={data.settings.logo_url} alt="" />
                  ) : (
                    <Boxes size={27} />
                  )}
                  <strong>{data.settings.name}</strong>
                </div>
                <p>
                  {data.settings.address}
                  <br />
                  {data.settings.phone}
                  {data.settings.tax_number && (
                    <>
                      <br />
                      {t('Tax no.')} {data.settings.tax_number}
                    </>
                  )}
                </p>
              </div>
              <div className="receipt-doc">
                <span>
                  {invoiceFormat && selectedDoc.kind === 'sale'
                    ? t('Tax invoice')
                    : documentLabel(selectedDoc.kind)}
                </span>
                <strong>{docNo(selectedDoc)}</strong>
                <small>{date(selectedDoc.occurred_at)}</small>
              </div>
            </div>
            <div className="receipt-parties">
              <div>
                <span>{isSale ? t('BILL TO') : t('SUPPLIER')}</span>
                <strong>{partyName(props, selectedDoc.party_id)}</strong>
                {invoiceFormat && selectedDoc.party_id && (
                  <small>
                    {data.parties.find((p) => p.id === selectedDoc.party_id)?.address}
                    {data.parties.find((p) => p.id === selectedDoc.party_id)?.tax_number && (
                      <>
                        <br />
                        {t('Tax no.')}{' '}
                        {data.parties.find((p) => p.id === selectedDoc.party_id)?.tax_number}
                      </>
                    )}
                  </small>
                )}
              </div>
              <div>
                <span>{t('WAREHOUSE')}</span>
                <strong>{whName(props, selectedDoc.warehouse_id)}</strong>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t('Item')}</th>
                  <th className="align-right">{t('Qty')}</th>
                  <th className="align-right">{t('Price')}</th>
                  {invoiceFormat && <th className="align-right">{t('Tax')}</th>}
                  <th className="align-right">{t('Total')}</th>
                </tr>
              </thead>
              <tbody>
                {selectedDoc.document_lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{productName(props, l.product_id)}</strong>
                      <small>{unitLabel(l.unit_name)}</small>
                    </td>
                    <td className="align-right">{number(l.quantity)}</td>
                    <td className="align-right">{money(l.unit_price, props)}</td>
                    {invoiceFormat && <td className="align-right">{money(l.tax, props)}</td>}
                    <td className="align-right">{money(l.total, props)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="receipt-totals">
              <div>
                <span>{t('Subtotal')}</span>
                <strong>{money(selectedDoc.subtotal, props)}</strong>
              </div>
              {Number(selectedDoc.discount) > 0 && (
                <div>
                  <span>{t('Discount')}</span>
                  <strong>-{money(selectedDoc.discount, props)}</strong>
                </div>
              )}
              <div>
                <span>{t('Tax')}</span>
                <strong>{money(selectedDoc.tax_total, props)}</strong>
              </div>
              <div className="grand">
                <span>{t('Total')}</span>
                <strong>{money(selectedDoc.total, props)}</strong>
              </div>
            </div>
            {selectedDoc.note && <p className="receipt-note">{selectedDoc.note}</p>}
            {selectedDoc.status === 'cancelled' && selectedDoc.cancelled_at && (
              <p className="receipt-note">
                {t('Cancelled on {date} by {name}', {
                  date: date(selectedDoc.cancelled_at),
                  name:
                    data.profiles.find((p) => p.user_id === selectedDoc.cancelled_by)?.full_name ||
                    t('Administrator'),
                })}
              </p>
            )}
            <p className="receipt-thanks">{t('Thank you for your business.')}</p>
          </div>
          <div className="form-actions no-print">
            <Button
              variant="secondary"
              onClick={() => {
                setReceipt('')
                setView('')
                setInvoiceFormat(false)
              }}
            >
              {t('Close')}
            </Button>
            {selectedDoc.kind === 'sale' && (
              <Button variant="secondary" onClick={() => setInvoiceFormat(!invoiceFormat)}>
                {invoiceFormat ? t('Receipt view') : t('Tax invoice view')}
              </Button>
            )}
            <Button onClick={() => window.print()} icon={<Printer size={16} />}>
              {t('Print / Save PDF')}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

export function Contacts(props: PageProps) {
  const { data, run, busy } = props
  const [filter, setFilter] = useState<'all' | 'customer' | 'supplier'>('all')
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<Partial<Party> | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [payment, setPayment] = useState<{
    party_id: string
    direction: string
    amount: number
    account_id: string
    note: string
  } | null>(null)
  const contacts = data.parties.filter(
    (p) =>
      (filter === 'all' || p.kind === filter || p.kind === 'both') &&
      `${p.name} ${p.phone} ${p.email}`.toLowerCase().includes(search.toLowerCase()),
  )
  const selected = data.parties.find((p) => p.id === detail)
  const paymentParty = payment ? data.parties.find((p) => p.id === payment.party_id) : null
  const statement = selected
    ? [
        ...data.documents
          .filter((d) => d.party_id === selected.id && d.status === 'posted')
          .map((d) => ({
            id: d.id,
            at: d.occurred_at,
            label: `${documentLabel(d.kind)} ${docNo(d)}`,
            amount: ['sale', 'purchase_return'].includes(d.kind)
              ? Number(d.total)
              : -Number(d.total),
          })),
        ...data.payments
          .filter((p) => p.party_id === selected.id)
          .map((p) => ({
            id: p.id,
            at: p.occurred_at,
            label:
              p.direction === 'receipt'
                ? t('Money received')
                : p.direction === 'payment'
                  ? t('Money paid')
                  : p.direction === 'refund_customer'
                    ? t('Customer refund')
                    : t('Supplier refund'),
            amount:
              (['payment', 'refund_customer'].includes(p.direction) ? 1 : -1) * Number(p.amount),
          })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : []
  let running = 0
  return (
    <>
      <Heading
        title={t('Contacts')}
        subtitle={t('Customers and suppliers, with every balance in view.')}
        action={
          <Button onClick={() => setEdit({ kind: 'customer' })} icon={<Plus size={17} />}>
            {t('Add contact')}
          </Button>
        }
      />
      <div className="summary-row">
        <div>
          <span>{t('Customers')}</span>
          <strong>{data.parties.filter((p) => p.kind !== 'supplier').length}</strong>
        </div>
        <div>
          <span>{t('Suppliers')}</span>
          <strong>{data.parties.filter((p) => p.kind !== 'customer').length}</strong>
        </div>
        <div>
          <span>{t('Customer receivables')}</span>
          <strong>
            {money(
              data.parties.reduce((s, p) => s + Math.max(0, customerBalance(data, p)), 0),
              props,
            )}
          </strong>
        </div>
        <div>
          <span>{t('Supplier payables')}</span>
          <strong>
            {money(
              data.parties.reduce((s, p) => s + Math.max(0, supplierBalance(data, p)), 0),
              props,
            )}
          </strong>
        </div>
      </div>
      <Card className="table-card">
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder={t('Search contacts')} />
          <div className="segmented">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              {t('All')}
            </button>
            <button
              className={filter === 'customer' ? 'active' : ''}
              onClick={() => setFilter('customer')}
            >
              {t('Customers')}
            </button>
            <button
              className={filter === 'supplier' ? 'active' : ''}
              onClick={() => setFilter('supplier')}
            >
              {t('Suppliers')}
            </button>
          </div>
        </div>
        {contacts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Contact')}</th>
                  <th className="align-right">{t('Balance')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="contact-name">
                        <span>{p.name.slice(0, 1).toUpperCase()}</span>
                        <strong>{p.name}</strong>
                      </div>
                    </td>
                    <td>
                      <Badge tone={p.kind === 'supplier' ? 'blue' : 'green'}>{t(p.kind)}</Badge>
                    </td>
                    <td>{p.phone || p.email || '—'}</td>
                    <td className="align-right strong">{money(partyBalance(data, p), props)}</td>
                    <td className="align-right">
                      <button className="table-action" onClick={() => setDetail(p.id)}>
                        {t('Statement')}
                      </button>
                      <button className="table-action" onClick={() => setEdit(p)}>
                        {t('Edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={t('No contacts yet')}
            description={t('Add a customer or supplier to track what is owed.')}
            action={() => setEdit({ kind: 'customer' })}
          />
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? t('Edit contact') : t('Add contact')} onClose={() => setEdit(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              const { id, ...values } = edit
              try {
                await run(() => saveRow('parties', values, id), t('Contact saved'), ['parties'])
                setEdit(null)
              } catch {}
            }}
          >
            <Field label={t('Name')}>
              <input
                required
                value={edit.name || ''}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label={t('Type')}>
              <select
                value={edit.kind || 'customer'}
                onChange={(e) => setEdit({ ...edit, kind: e.target.value as Party['kind'] })}
              >
                <option value="customer">{t('Customer')}</option>
                <option value="supplier">{t('Supplier')}</option>
                <option value="both">{t('Both')}</option>
              </select>
            </Field>
            <Field label={t('Phone')}>
              <input
                value={edit.phone || ''}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
              />
            </Field>
            <Field label={t('Email')}>
              <input
                type="email"
                value={edit.email || ''}
                onChange={(e) => setEdit({ ...edit, email: e.target.value })}
              />
            </Field>
            <Field label={t('Tax number')}>
              <input
                value={edit.tax_number || ''}
                onChange={(e) => setEdit({ ...edit, tax_number: e.target.value })}
              />
            </Field>
            <Field label={t('Address')}>
              <input
                value={edit.address || ''}
                onChange={(e) => setEdit({ ...edit, address: e.target.value })}
              />
            </Field>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Save contact')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={t('{name} · statement', { name: selected.name })}
          width="wide"
          onClose={() => setDetail(null)}
        >
          <div className="statement-head">
            <div>
              <span className="eyebrow">{t('CURRENT BALANCE')}</span>
              <strong>{money(partyBalance(data, selected), props)}</strong>
              <small>{t('Positive: they owe you. Negative: you owe them.')}</small>
            </div>
            <Button
              onClick={() => {
                setPayment({
                  party_id: selected.id,
                  direction:
                    selected.kind === 'supplier'
                      ? supplierBalance(data, selected) < 0
                        ? 'refund_supplier'
                        : 'payment'
                      : customerBalance(data, selected) < 0
                        ? 'refund_customer'
                        : 'receipt',
                  amount: 0,
                  account_id: data.accounts.find((a) => a.is_cash)?.id || '',
                  note: '',
                })
                setDetail(null)
              }}
              icon={<Plus size={16} />}
            >
              {t('Record payment')}
            </Button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Activity')}</th>
                  <th className="align-right">{t('Change')}</th>
                  <th className="align-right">{t('Running balance')}</th>
                </tr>
              </thead>
              <tbody>
                {statement.map((item) => {
                  running += item.amount
                  return (
                    <tr key={item.id}>
                      <td>{date(item.at)}</td>
                      <td>
                        <strong>{item.label}</strong>
                      </td>
                      <td className={`align-right ${item.amount >= 0 ? 'positive' : 'negative'}`}>
                        {item.amount >= 0 ? '+' : ''}
                        {money(item.amount, props)}
                      </td>
                      <td className="align-right strong">{money(running, props)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!statement.length && (
              <Empty
                title={t('No activity')}
                description={t('Sales, purchases and payments will build this statement.')}
              />
            )}
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setDetail(null)}>
              {t('Close')}
            </Button>
            <Button
              variant="secondary"
              icon={<Download size={16} />}
              onClick={() =>
                exportCsv(t('{name}-statement.csv', { name: selected.name }), [
                  [t('Date'), t('Activity'), t('Change')],
                  ...statement.map((s) => [date(s.at), s.label, s.amount]),
                ])
              }
            >
              {t('Export CSV')}
            </Button>
          </div>
        </Modal>
      )}
      {payment && (
        <Modal title={t('Record payment')} onClose={() => setPayment(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(
                  () =>
                    call('record_payment', {
                      p_party: payment.party_id,
                      p_direction: payment.direction,
                      p_amount: payment.amount,
                      p_account: payment.account_id,
                      p_note: payment.note,
                    }),
                  t('Payment recorded'),
                  ['payments', 'journalLines'],
                )
                setPayment(null)
              } catch {}
            }}
          >
            <Field label={t('Direction')}>
              <select
                value={payment.direction}
                onChange={(e) => setPayment({ ...payment, direction: e.target.value })}
              >
                {paymentParty?.kind !== 'supplier' && (
                  <option value="receipt">{t('Money received from customer')}</option>
                )}
                {paymentParty?.kind !== 'customer' && (
                  <option value="payment">{t('Money paid to supplier')}</option>
                )}
                {paymentParty &&
                  paymentParty.kind !== 'supplier' &&
                  customerBalance(data, paymentParty) < 0 && (
                    <option value="refund_customer">{t('Refund to customer')}</option>
                  )}
                {paymentParty &&
                  paymentParty.kind !== 'customer' &&
                  supplierBalance(data, paymentParty) < 0 && (
                    <option value="refund_supplier">{t('Refund from supplier')}</option>
                  )}
              </select>
            </Field>
            <Field label={t('Amount')}>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={payment.amount || ''}
                onChange={(e) => setPayment({ ...payment, amount: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('Cash / bank account')}>
              <select
                value={payment.account_id}
                onChange={(e) => setPayment({ ...payment, account_id: e.target.value })}
              >
                {data.accounts
                  .filter((a) => a.is_cash && a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('Note')}>
              <input
                value={payment.note}
                onChange={(e) => setPayment({ ...payment, note: e.target.value })}
              />
            </Field>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setPayment(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Save payment')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

export function Finance(props: PageProps) {
  const { data, run, busy } = props
  const [tab, setTab] = useState<'accounts' | 'expenses' | 'attendance' | 'payroll'>('accounts')
  const [account, setAccount] = useState<{
    code: string
    name: string
    type: string
    is_cash: boolean
    active: boolean
  } | null>(null)
  const [expense, setExpense] = useState<{
    account_id: string
    cash_account_id: string
    description: string
    amount: number
  } | null>(null)
  const [salary, setSalary] = useState<{
    staff_id: string
    period: string
    gross: number
    cash_account_id: string
  } | null>(null)
  const [attendance, setAttendance] = useState<{
    staff_id: string
    day: string
    status: string
    note: string
  } | null>(null)
  const cash = data.accounts.filter((a) => a.is_cash && a.active)
  const expenseAccounts = data.accounts.filter((a) => a.type === 'expense' && a.active)
  const accountBalances = data.accounts.map((a) => ({
    ...a,
    balance: data.journalLines
      .filter((l) => l.account_id === a.id)
      .reduce(
        (s, l) =>
          s +
          (a.type === 'asset' || a.type === 'expense'
            ? Number(l.debit) - Number(l.credit)
            : Number(l.credit) - Number(l.debit)),
        0,
      ),
  }))
  return (
    <>
      <Heading
        title={t('Accounts & staff')}
        subtitle={t('A practical view of cash, costs, attendance and pay.')}
        action={
          tab === 'expenses' ? (
            <Button
              icon={<Plus size={17} />}
              onClick={() =>
                setExpense({
                  account_id: expenseAccounts[0]?.id || '',
                  cash_account_id: cash[0]?.id || '',
                  description: '',
                  amount: 0,
                })
              }
            >
              {t('New expense')}
            </Button>
          ) : tab === 'payroll' ? (
            <Button
              icon={<Plus size={17} />}
              onClick={() =>
                setSalary({
                  staff_id: data.profiles[0]?.user_id || '',
                  period: today().slice(0, 7),
                  gross: 0,
                  cash_account_id: cash[0]?.id || '',
                })
              }
            >
              {t('Pay salary')}
            </Button>
          ) : tab === 'attendance' ? (
            <Button
              icon={<Plus size={17} />}
              onClick={() =>
                setAttendance({
                  staff_id: data.profiles[0]?.user_id || '',
                  day: today(),
                  status: 'present',
                  note: '',
                })
              }
            >
              {t('Record attendance')}
            </Button>
          ) : (
            <Button
              icon={<Plus size={17} />}
              onClick={() =>
                setAccount({ code: '', name: '', type: 'expense', is_cash: false, active: true })
              }
            >
              {t('New account')}
            </Button>
          )
        }
      />
      <div className="tabs">
        <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>
          {t('Chart of accounts')}
        </button>
        <button className={tab === 'expenses' ? 'active' : ''} onClick={() => setTab('expenses')}>
          {t('Expenses')}
        </button>
        <button
          className={tab === 'attendance' ? 'active' : ''}
          onClick={() => setTab('attendance')}
        >
          {t('Attendance')}
        </button>
        <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>
          {t('Payroll')}
        </button>
      </div>
      {tab === 'accounts' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Chart of accounts')}</h2>
              <p>{t('Balances are calculated from posted journal entries.')}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Code')}</th>
                  <th>{t('Account')}</th>
                  <th>{t('Type')}</th>
                  <th className="align-right">{t('Balance')}</th>
                </tr>
              </thead>
              <tbody>
                {accountBalances
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.code}</td>
                      <td>
                        <strong>{accountLabel(a)}</strong>
                        {a.is_cash && <small>{t('Payment account')}</small>}
                      </td>
                      <td>
                        <Badge
                          tone={
                            a.type === 'asset' ? 'blue' : a.type === 'income' ? 'green' : 'neutral'
                          }
                        >
                          {t(a.type)}
                        </Badge>
                      </td>
                      <td className="align-right strong">{money(a.balance, props)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === 'expenses' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Operating expenses')}</h2>
              <p>{t('Each expense creates a balanced journal entry.')}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Description')}</th>
                  <th>{t('Account')}</th>
                  <th className="align-right">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.expenses]
                  .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                  .map((e) => (
                    <tr key={e.id}>
                      <td>{date(e.occurred_at)}</td>
                      <td>
                        <strong>{e.description}</strong>
                      </td>
                      <td>{accountName(props, e.account_id)}</td>
                      <td className="align-right strong">{money(e.amount, props)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.expenses.length && (
              <Empty
                title={t('No expenses yet')}
                description={t('Record rent, utilities or other business costs.')}
                action={() =>
                  setExpense({
                    account_id: expenseAccounts[0]?.id || '',
                    cash_account_id: cash[0]?.id || '',
                    description: '',
                    amount: 0,
                  })
                }
              />
            )}
          </div>
        </Card>
      )}
      {tab === 'attendance' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Staff attendance')}</h2>
              <p>{t('One record per staff member and day.')}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Date')}</th>
                  <th>{t('Staff member')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Note')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.attendance]
                  .sort((a, b) => b.day.localeCompare(a.day))
                  .map((a) => (
                    <tr key={a.id}>
                      <td>{date(a.day)}</td>
                      <td>
                        <strong>
                          {data.profiles.find((p) => p.user_id === a.staff_id)?.full_name}
                        </strong>
                      </td>
                      <td>
                        <Badge
                          tone={
                            a.status === 'present'
                              ? 'green'
                              : a.status === 'absent'
                                ? 'red'
                                : 'amber'
                          }
                        >
                          {t(a.status)}
                        </Badge>
                      </td>
                      <td>{a.note || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.attendance.length && (
              <Empty
                title={t('No attendance recorded')}
                description={t('Keep a simple daily record for your team.')}
              />
            )}
          </div>
        </Card>
      )}
      {tab === 'payroll' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Salary payments')}</h2>
              <p>{t('Paid salaries are recorded as expenses.')}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Period')}</th>
                  <th>{t('Staff member')}</th>
                  <th>{t('Paid on')}</th>
                  <th className="align-right">{t('Gross pay')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.payroll]
                  .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.period}</td>
                      <td>
                        <strong>
                          {data.profiles.find((x) => x.user_id === p.staff_id)?.full_name}
                        </strong>
                      </td>
                      <td>{date(p.paid_at)}</td>
                      <td className="align-right strong">{money(p.gross, props)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.payroll.length && (
              <Empty
                title={t('No salaries paid')}
                description={t('Salary payments will appear here.')}
              />
            )}
          </div>
        </Card>
      )}
      {account && (
        <Modal title={t('New account')} onClose={() => setAccount(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(() => saveRow('accounts', account), t('Account created'), ['accounts'])
                setAccount(null)
              } catch {}
            }}
          >
            <Field label={t('Account code')}>
              <input
                required
                value={account.code}
                onChange={(e) => setAccount({ ...account, code: e.target.value })}
              />
            </Field>
            <Field label={t('Account name')}>
              <input
                required
                value={account.name}
                onChange={(e) => setAccount({ ...account, name: e.target.value })}
              />
            </Field>
            <Field label={t('Type')}>
              <select
                value={account.type}
                onChange={(e) => setAccount({ ...account, type: e.target.value })}
              >
                {['asset', 'liability', 'income', 'expense', 'equity'].map((x) => (
                  <option key={x} value={x}>
                    {t(x)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check-field">
              <input
                type="checkbox"
                checked={account.is_cash}
                onChange={(e) => setAccount({ ...account, is_cash: e.target.checked })}
              />{' '}
              {t('Use for cash or bank payments')}
            </label>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setAccount(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Create account')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {expense && (
        <Modal title={t('Record expense')} onClose={() => setExpense(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(
                  () =>
                    call('record_expense', {
                      p_account: expense.account_id,
                      p_cash_account: expense.cash_account_id,
                      p_description: expense.description,
                      p_amount: expense.amount,
                    }),
                  t('Expense recorded'),
                  ['expenses', 'journalLines'],
                )
                setExpense(null)
              } catch {}
            }}
          >
            <Field label={t('Description')}>
              <input
                required
                value={expense.description}
                onChange={(e) => setExpense({ ...expense, description: e.target.value })}
              />
            </Field>
            <Field label={t('Expense account')}>
              <select
                value={expense.account_id}
                onChange={(e) => setExpense({ ...expense, account_id: e.target.value })}
              >
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Paid from')}>
              <select
                value={expense.cash_account_id}
                onChange={(e) => setExpense({ ...expense, cash_account_id: e.target.value })}
              >
                {cash.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Amount')}>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={expense.amount || ''}
                onChange={(e) => setExpense({ ...expense, amount: Number(e.target.value) })}
              />
            </Field>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setExpense(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Record expense')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {attendance && (
        <Modal title={t('Record attendance')} onClose={() => setAttendance(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(() => saveRow('attendance', attendance), t('Attendance recorded'), [
                  'attendance',
                ])
                setAttendance(null)
              } catch {}
            }}
          >
            <Field label={t('Staff member')}>
              <select
                value={attendance.staff_id}
                onChange={(e) => setAttendance({ ...attendance, staff_id: e.target.value })}
              >
                {data.profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('Day')}>
              <input
                type="date"
                required
                value={attendance.day}
                onChange={(e) => setAttendance({ ...attendance, day: e.target.value })}
              />
            </Field>
            <Field label={t('Status')}>
              <select
                value={attendance.status}
                onChange={(e) => setAttendance({ ...attendance, status: e.target.value })}
              >
                <option value="present">{t('Present')}</option>
                <option value="absent">{t('Absent')}</option>
                <option value="leave">{t('Leave')}</option>
              </select>
            </Field>
            <Field label={t('Note')}>
              <input
                value={attendance.note}
                onChange={(e) => setAttendance({ ...attendance, note: e.target.value })}
              />
            </Field>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setAttendance(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Save attendance')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {salary && (
        <Modal title={t('Pay salary')} onClose={() => setSalary(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(
                  () =>
                    call('pay_salary', {
                      p_staff: salary.staff_id,
                      p_period: salary.period,
                      p_gross: salary.gross,
                      p_cash_account: salary.cash_account_id,
                    }),
                  t('Salary paid'),
                  ['payroll', 'journalLines'],
                )
                setSalary(null)
              } catch {}
            }}
          >
            <Field label={t('Staff member')}>
              <select
                value={salary.staff_id}
                onChange={(e) => setSalary({ ...salary, staff_id: e.target.value })}
              >
                {data.profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('Period')}>
              <input
                type="month"
                required
                value={salary.period}
                onChange={(e) => setSalary({ ...salary, period: e.target.value })}
              />
            </Field>
            <Field label={t('Gross salary')}>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={salary.gross || ''}
                onChange={(e) => setSalary({ ...salary, gross: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('Paid from')}>
              <select
                value={salary.cash_account_id}
                onChange={(e) => setSalary({ ...salary, cash_account_id: e.target.value })}
              >
                {cash.map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setSalary(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Record salary')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

export function Reports(props: PageProps) {
  const { data } = props
  const [tab, setTab] = useState<'sales' | 'inventory' | 'tax' | 'returns'>('sales')
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(today())
  const [warehouse, setWarehouse] = useState('')
  const [stockRows, setStockRows] = useState<
    {
      product_id: string
      warehouse_id: string
      opening_quantity: number
      received_quantity: number
      issued_quantity: number
      closing_quantity: number
      closing_value: number
    }[]
  >([])
  const [reportError, setReportError] = useState('')
  const [loading, setLoading] = useState(false)
  const [appliedStockFilter, setAppliedStockFilter] = useState<{
    from: string
    to: string
    warehouse: string
  } | null>(null)
  const reportRequest = useRef(0)
  const stockFresh =
    !!appliedStockFilter &&
    !loading &&
    !reportError &&
    appliedStockFilter.from === from &&
    appliedStockFilter.to === to &&
    appliedStockFilter.warehouse === warehouse
  const visibleStockRows = stockFresh ? stockRows : []
  const filtered = data.documents.filter(
    (d) =>
      localDay(d.occurred_at) >= from &&
      localDay(d.occurred_at) <= to &&
      (!warehouse || d.warehouse_id === warehouse),
  )
  const sales = filtered.filter((d) => d.kind === 'sale')
  const saleReturns = filtered.filter((d) => d.kind === 'sale_return')
  const purchases = filtered.filter((d) => d.kind === 'purchase')
  const purchaseReturns = filtered.filter((d) => d.kind === 'purchase_return')
  const netSales =
    sales.reduce((s, d) => s + Number(d.total), 0) -
    saleReturns.reduce((s, d) => s + Number(d.total), 0)
  const byPeriod = useMemo(() => {
    const buckets = new Map<
      string,
      { period: string; sales: number; returns: number; tax: number }
    >()
    for (const d of filtered.filter((d) => ['sale', 'sale_return'].includes(d.kind))) {
      const key = monthKey(d.occurred_at)
      const b = buckets.get(key) || { period: key, sales: 0, returns: 0, tax: 0 }
      if (d.kind === 'sale') b.sales += Number(d.total)
      else b.returns += Number(d.total)
      b.tax += Number(d.tax_total) * (d.kind === 'sale' ? 1 : -1)
      buckets.set(key, b)
    }
    return [...buckets.values()].sort((a, b) => b.period.localeCompare(a.period))
  }, [filtered])
  async function loadStock() {
    const request = ++reportRequest.current
    const filters = { from, to, warehouse }
    setLoading(true)
    setReportError('')
    setStockRows([])
    setAppliedStockFilter(null)
    try {
      const rows = await call<typeof stockRows>('stock_balance_report', {
        p_from: filters.from,
        p_to: filters.to,
        p_warehouse: filters.warehouse || null,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (request === reportRequest.current) {
        setStockRows(rows)
        setAppliedStockFilter(filters)
      }
    } catch (e) {
      if (request === reportRequest.current)
        setReportError(e instanceof Error ? e.message : String(e))
    } finally {
      if (request === reportRequest.current) setLoading(false)
    }
  }
  return (
    <>
      <Heading
        title={t('Reports')}
        subtitle={t('Answers from the transactions and stock movements you have recorded.')}
        action={
          <Button
            variant="secondary"
            icon={<FileDown size={16} />}
            disabled={tab === 'inventory' && !stockFresh}
            onClick={() => {
              if (tab === 'inventory')
                exportCsv(t('stock-balance.csv'), [
                  [
                    t('Product'),
                    t('Warehouse'),
                    t('Opening'),
                    t('Received'),
                    t('Issued'),
                    t('Closing'),
                    t('Value'),
                  ],
                  ...visibleStockRows.map((r) => [
                    productName(props, r.product_id),
                    whName(props, r.warehouse_id),
                    r.opening_quantity,
                    r.received_quantity,
                    r.issued_quantity,
                    r.closing_quantity,
                    r.closing_value,
                  ]),
                ])
              else if (tab === 'sales')
                exportCsv(t('sales-report.csv'), [
                  [t('Month'), t('Sales'), t('Returns'), t('Net'), t('Tax')],
                  ...byPeriod.map((r) => [
                    r.period,
                    r.sales,
                    r.returns,
                    r.sales - r.returns,
                    r.tax,
                  ]),
                ])
              else
                exportCsv(tab === 'tax' ? t('tax-report.csv') : t('returns-report.csv'), [
                  [t('Document'), t('Date'), t('Kind'), t('Total'), t('Tax')],
                  ...filtered
                    .filter((d) =>
                      tab === 'tax'
                        ? ['sale', 'purchase', 'sale_return', 'purchase_return'].includes(d.kind)
                        : d.kind.endsWith('_return'),
                    )
                    .map((d) => [
                      docNo(d),
                      date(d.occurred_at),
                      documentLabel(d.kind),
                      d.total,
                      d.tax_total,
                    ]),
                ])
            }}
          >
            {t('Export CSV')}
          </Button>
        }
      />
      <Card className="report-filter">
        <div className="filter-icon">
          <Filter size={19} />
        </div>
        <Field label={t('From')}>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('To')}>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('Warehouse')}>
          <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">{t('All warehouses')}</option>
            {data.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Button onClick={loadStock} variant="secondary">
          {t('Apply filters')}
        </Button>
      </Card>
      <div className="tabs">
        <button className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>
          {t('Sales')}
        </button>
        <button
          className={tab === 'inventory' ? 'active' : ''}
          onClick={() => {
            setTab('inventory')
            void loadStock()
          }}
        >
          {t('Stock balance & valuation')}
        </button>
        <button className={tab === 'tax' ? 'active' : ''} onClick={() => setTab('tax')}>
          {t('Tax')}
        </button>
        <button className={tab === 'returns' ? 'active' : ''} onClick={() => setTab('returns')}>
          {t('Returns')}
        </button>
      </div>
      {tab === 'sales' && (
        <>
          <div className="metrics-grid three">
            <Metric
              label={t('Net sales')}
              value={money(netSales, props)}
              note={t('{count} sales in range', { count: sales.length })}
              icon={TrendingUp}
            />
            <Metric
              label={t('Sales returns')}
              value={money(
                saleReturns.reduce((s, d) => s + Number(d.total), 0),
                props,
              )}
              note={t('{count} returns', { count: saleReturns.length })}
              icon={RotateCcw}
              tone="amber"
            />
            <Metric
              label={t('Average sale')}
              value={money(
                sales.length ? sales.reduce((s, d) => s + Number(d.total), 0) / sales.length : 0,
                props,
              )}
              note={t('Before returns')}
              icon={ReceiptText}
              tone="blue"
            />
          </div>
          <Card className="table-card">
            <div className="card-title-row">
              <div>
                <h2>{t('Monthly sales')}</h2>
                <p>{t('Quarterly totals appear below.')}</p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('Month')}</th>
                    <th className="align-right">{t('Sales')}</th>
                    <th className="align-right">{t('Returns')}</th>
                    <th className="align-right">{t('Net')}</th>
                    <th className="align-right">{t('Tax')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byPeriod.map((r) => (
                    <tr key={r.period}>
                      <td>
                        <strong>{r.period}</strong>
                      </td>
                      <td className="align-right">{money(r.sales, props)}</td>
                      <td className="align-right">{money(r.returns, props)}</td>
                      <td className="align-right strong">{money(r.sales - r.returns, props)}</td>
                      <td className="align-right">{money(r.tax, props)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!byPeriod.length && (
                <Empty
                  title={t('No sales in this period')}
                  description={t('Try a wider date range.')}
                />
              )}
            </div>
          </Card>
          <Card className="table-card quarterly-card">
            <div className="card-title-row">
              <div>
                <h2>{t('Quarterly summary')}</h2>
                <p>{t('Net sales by calendar quarter.')}</p>
              </div>
            </div>
            <div className="quarter-list">
              {Object.entries(
                byPeriod.reduce<Record<string, number>>((acc, r) => {
                  const [year, month] = r.period.split('-').map(Number)
                  const key = `${year} Q${Math.ceil(month / 3)}`
                  acc[key] = (acc[key] || 0) + r.sales - r.returns
                  return acc
                }, {}),
              ).map(([key, value]) => (
                <div key={key}>
                  <strong>
                    {t('Quarter {quarter}, {year}', {
                      quarter: Number(key.split(' Q')[1]),
                      year: key.split(' Q')[0],
                    })}
                  </strong>
                  <span>{money(value, props)}</span>
                </div>
              ))}
              {!byPeriod.length && <p>{t('No quarters in this range.')}</p>}
            </div>
          </Card>
        </>
      )}
      {tab === 'inventory' && (
        <>
          {stockFresh && (
            <div className="metrics-grid three">
              <Metric
                label={t('Closing quantity')}
                value={number(visibleStockRows.reduce((s, r) => s + Number(r.closing_quantity), 0))}
                note={t('Base units across products')}
                icon={Boxes}
              />
              <Metric
                label={t('Stock value')}
                value={money(
                  visibleStockRows.reduce((s, r) => s + Number(r.closing_value), 0),
                  props,
                )}
                note={t('As of {date}', { date: date(to) })}
                icon={Package}
                tone="blue"
              />
              <Metric
                label={t('Movements')}
                value={number(
                  visibleStockRows.reduce(
                    (s, r) => s + Number(r.received_quantity) + Number(r.issued_quantity),
                    0,
                  ),
                )}
                note={t('Units moved in range')}
                icon={ArrowUpRight}
                tone="amber"
              />
            </div>
          )}
          <Card className="table-card">
            <div className="card-title-row">
              <div>
                <h2>{t('Stock balance & valuation')}</h2>
                <p>{t('Opening + receipts − issues = closing. Values are as of the end date.')}</p>
              </div>
              {stockFresh && (
                <Badge tone="blue">
                  {warehouse ? whName(props, warehouse) : t('All warehouses')}
                </Badge>
              )}
            </div>
            {reportError && <div className="form-error">{localizeError(reportError)}</div>}
            {loading ? (
              <div className="loading-line">{t('Loading report…')}</div>
            ) : !stockFresh ? (
              <Empty
                title={t('Apply filters to view stock')}
                description={t('Run the report for the selected dates and warehouse.')}
                action={loadStock}
              />
            ) : visibleStockRows.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Product / warehouse')}</th>
                      <th className="align-right">{t('Opening')}</th>
                      <th className="align-right">{t('In')}</th>
                      <th className="align-right">{t('Out')}</th>
                      <th className="align-right">{t('Closing')}</th>
                      <th className="align-right">{t('Value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStockRows.map((r, i) => (
                      <tr key={`${r.product_id}-${r.warehouse_id}-${i}`}>
                        <td>
                          <strong>{productName(props, r.product_id)}</strong>
                          <small>
                            {whName(props, r.warehouse_id)} ·{' '}
                            {unitLabel(data.products.find((p) => p.id === r.product_id)?.base_unit)}
                          </small>
                        </td>
                        <td className="align-right">{number(r.opening_quantity)}</td>
                        <td className="align-right positive">{number(r.received_quantity)}</td>
                        <td className="align-right negative">{number(r.issued_quantity)}</td>
                        <td className="align-right strong">{number(r.closing_quantity)}</td>
                        <td className="align-right strong">{money(r.closing_value, props)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title={t('No stock in this period')}
                description={t('Record opening stock or a purchase, then run the report.')}
                action={loadStock}
              />
            )}
          </Card>
        </>
      )}
      {tab === 'tax' && (
        <>
          <div className="metrics-grid three">
            <Metric
              label={t('Output tax')}
              value={money(
                sales.reduce((s, d) => s + Number(d.tax_total), 0) -
                  saleReturns.reduce((s, d) => s + Number(d.tax_total), 0),
                props,
              )}
              note={t('Sales less returns')}
              icon={ArrowUpRight}
            />
            <Metric
              label={t('Input tax')}
              value={money(
                purchases.reduce((s, d) => s + Number(d.tax_total), 0) -
                  purchaseReturns.reduce((s, d) => s + Number(d.tax_total), 0),
                props,
              )}
              note={t('Purchases less returns')}
              icon={ArrowDownLeft}
              tone="blue"
            />
            <Metric
              label={t('Net tax')}
              value={money(
                sales.reduce((s, d) => s + Number(d.tax_total), 0) -
                  saleReturns.reduce((s, d) => s + Number(d.tax_total), 0) -
                  purchases.reduce((s, d) => s + Number(d.tax_total), 0) +
                  purchaseReturns.reduce((s, d) => s + Number(d.tax_total), 0),
                props,
              )}
              note={t('Output minus input')}
              icon={ReceiptText}
              tone="amber"
            />
          </div>
          <Card className="table-card">
            <div className="card-title-row">
              <div>
                <h2>{t('Tax transactions')}</h2>
                <p>{t('Line tax is calculated when each document is posted.')}</p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('Document')}</th>
                    <th>{t('Date')}</th>
                    <th>{t('Contact')}</th>
                    <th className="align-right">{t('Net amount')}</th>
                    <th className="align-right">{t('Tax')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .filter((d) =>
                      ['sale', 'purchase', 'sale_return', 'purchase_return'].includes(d.kind),
                    )
                    .map((d) => (
                      <tr key={d.id}>
                        <td>
                          <strong>{docNo(d)}</strong>
                          <small>{documentLabel(d.kind)}</small>
                        </td>
                        <td>{date(d.occurred_at)}</td>
                        <td>{partyName(props, d.party_id)}</td>
                        <td className="align-right">
                          {money(Number(d.total) - Number(d.tax_total), props)}
                        </td>
                        <td className="align-right strong">{money(d.tax_total, props)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {tab === 'returns' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Returns')}</h2>
              <p>{t('Sales and purchase returns in the selected period.')}</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Return')}</th>
                  <th>{t('Original')}</th>
                  <th>{t('Date')}</th>
                  <th>{t('Contact')}</th>
                  <th className="align-right">{t('Total')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .filter((d) => d.kind.endsWith('_return'))
                  .map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{docNo(d)}</strong>
                        <small>{documentLabel(d.kind)}</small>
                      </td>
                      <td>
                        {data.documents.find((x) => x.id === d.reference_id)
                          ? docNo(data.documents.find((x) => x.id === d.reference_id)!)
                          : '—'}
                      </td>
                      <td>{date(d.occurred_at)}</td>
                      <td>{partyName(props, d.party_id)}</td>
                      <td className="align-right strong">{money(d.total, props)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!filtered.some((d) => d.kind.endsWith('_return')) && (
              <Empty
                title={t('No returns')}
                description={t('There are no returns in this date range.')}
              />
            )}
          </div>
        </Card>
      )}
    </>
  )
}

export function SettingsPage(props: PageProps) {
  const { data, run, busy } = props
  const [tab, setTab] = useState<'business' | 'staff' | 'security'>('business')
  const [settings, setSettings] = useState({ ...data.settings })
  const [staffForm, setStaffForm] = useState<{
    email: string
    full_name: string
    role: 'admin' | 'cashier'
  } | null>(null)
  const [staffEdit, setStaffEdit] = useState<{
    user_id: string
    full_name: string
    role: 'admin' | 'cashier'
    active: boolean
  } | null>(null)
  const [tempPassword, setTempPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [logoFileName, setLogoFileName] = useState('')
  async function manageStaff(body: Record<string, unknown>) {
    const { data, error } = await db.functions.invoke('manage-staff', { body })
    if (error) {
      const response = 'context' in error ? error.context : null
      if (response instanceof Response) {
        let details: { error?: string } | null = null
        try {
          details = await response.clone().json()
        } catch {
          /* Keep the original network error. */
        }
        if (details?.error) throw new Error(details.error)
      }
      throw error
    }
    if (data?.error) throw new Error(data.error)
    return data
  }
  return (
    <>
      <Heading
        title={t('Settings')}
        subtitle={t('Your business profile, team access and account security.')}
      />
      <div className="tabs">
        <button className={tab === 'business' ? 'active' : ''} onClick={() => setTab('business')}>
          {t('Business details')}
        </button>
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>
          {t('Team access')}
        </button>
        <button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}>
          {t('My password')}
        </button>
      </div>
      {tab === 'business' && (
        <div className="settings-grid">
          <Card className="settings-card">
            <div className="card-title-row">
              <div>
                <h2>{t('Business profile')}</h2>
                <p>{t('Printed on receipts and invoices.')}</p>
              </div>
            </div>
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await run(
                    async () => {
                      const { error } = await db
                        .from('business_settings')
                        .update({
                          name: settings.name,
                          tax_number: settings.tax_number,
                          currency: settings.currency,
                          address: settings.address,
                          phone: settings.phone,
                          logo_url: settings.logo_url,
                          updated_at: new Date().toISOString(),
                        })
                        .eq('id', 1)
                      if (error) throw error
                    },
                    t('Business settings saved'),
                    ['settings'],
                  )
                } catch {}
              }}
            >
              <Field label={t('Business name')}>
                <input
                  required
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                />
              </Field>
              <Field label={t('Tax number')}>
                <input
                  value={settings.tax_number}
                  onChange={(e) => setSettings({ ...settings, tax_number: e.target.value })}
                />
              </Field>
              <Field label={t('Currency code')}>
                <input
                  required
                  maxLength={3}
                  value={settings.currency}
                  onChange={(e) =>
                    setSettings({ ...settings, currency: e.target.value.toUpperCase() })
                  }
                  placeholder="USD"
                />
              </Field>
              <Field label={t('Phone')}>
                <input
                  value={settings.phone}
                  onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                />
              </Field>
              <Field label={t('Address')}>
                <input
                  value={settings.address}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                />
              </Field>
              <Field label={t('Logo URL')}>
                <input
                  type="text"
                  value={
                    settings.logo_url.startsWith('data:') ? t('Uploaded image') : settings.logo_url
                  }
                  onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })}
                  placeholder="https://…"
                />
              </Field>
              <Field label={t('Upload logo')} hint={t('PNG, JPEG or WebP, up to 200 KB.')}>
                <span className="file-picker">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label={t('Upload logo')}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 200000) {
                        window.alert(t('Choose an image smaller than 200 KB'))
                        e.target.value = ''
                        return
                      }
                      setLogoFileName(file.name)
                      const reader = new FileReader()
                      reader.onload = () =>
                        setSettings((current) => ({ ...current, logo_url: String(reader.result) }))
                      reader.readAsDataURL(file)
                    }}
                  />
                  <span className="file-picker-action">{t('Choose image')}</span>
                  <span className="file-picker-name">
                    {logoFileName ||
                      (settings.logo_url ? t('Current logo') : t('No image selected'))}
                  </span>
                </span>
              </Field>
              <div className="form-actions">
                <Button type="submit" disabled={busy} icon={<Save size={16} />}>
                  {t('Save changes')}
                </Button>
              </div>
            </form>
          </Card>
          <Card className="settings-preview">
            <span className="eyebrow">{t('PREVIEW')}</span>
            <div className="preview-logo">
              {settings.logo_url ? (
                <img src={settings.logo_url} alt={t('Business logo')} />
              ) : (
                <Boxes size={32} />
              )}
            </div>
            <h2>{settings.name || t('Your business')}</h2>
            <p>
              {settings.address || t('Business address')}
              <br />
              {settings.phone || t('Phone number')}
            </p>
            <div>
              <span>{t('Tax number')}</span>
              <strong>{settings.tax_number || '—'}</strong>
            </div>
            <div>
              <span>{t('Currency')}</span>
              <strong>{settings.currency}</strong>
            </div>
          </Card>
        </div>
      )}
      {tab === 'staff' && (
        <Card className="table-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Team access')}</h2>
              <p>{t('Administrators manage the business; cashiers record sales.')}</p>
            </div>
            <Button
              onClick={() => setStaffForm({ email: '', full_name: '', role: 'cashier' })}
              icon={<Plus size={16} />}
            >
              {t('Add staff')}
            </Button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('Member')}</th>
                  <th>{t('Role')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Joined')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.profiles.map((p) => (
                  <tr key={p.user_id}>
                    <td>
                      <div className="contact-name">
                        <span>{p.full_name.slice(0, 1)}</span>
                        <strong>{p.full_name}</strong>
                      </div>
                    </td>
                    <td>
                      <Badge tone={p.role === 'admin' ? 'blue' : 'neutral'}>{t(p.role)}</Badge>
                    </td>
                    <td>
                      <Badge tone={p.active ? 'green' : 'red'}>
                        {p.active ? t('Active') : t('Disabled')}
                      </Badge>
                    </td>
                    <td>{date(p.created_at)}</td>
                    <td className="align-right">
                      <button
                        className="table-action"
                        onClick={() =>
                          setStaffEdit({
                            user_id: p.user_id,
                            full_name: p.full_name,
                            role: p.role,
                            active: p.active,
                          })
                        }
                      >
                        {t('Manage')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === 'security' && (
        <Card className="settings-card narrow-card">
          <div className="card-title-row">
            <div>
              <h2>{t('Change my password')}</h2>
              <p>{t('Choose a new password for your own account.')}</p>
            </div>
          </div>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(
                  async () => {
                    const { error } = await db.auth.updateUser({ password: newPassword })
                    if (error) throw error
                  },
                  t('Password updated'),
                  [],
                )
                setNewPassword('')
              } catch {}
            }}
          >
            <Field label={t('New password')}>
              <input
                type="password"
                minLength={12}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <div className="form-actions">
              <Button type="submit" disabled={busy || newPassword.length < 12}>
                {t('Update password')}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {staffForm && (
        <Modal title={t('Add staff member')} onClose={() => setStaffForm(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                const result = (await run(
                  () => manageStaff({ action: 'create', ...staffForm }),
                  t('Staff account created'),
                  ['profiles'],
                )) as { temporary_password: string }
                setTempPassword(result.temporary_password)
                setStaffForm(null)
              } catch {}
            }}
          >
            <Field label={t('Full name')}>
              <input
                required
                value={staffForm.full_name}
                onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
              />
            </Field>
            <Field label={t('Email')}>
              <input
                type="email"
                required
                value={staffForm.email}
                onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
              />
            </Field>
            <Field label={t('Role')}>
              <select
                value={staffForm.role}
                onChange={(e) =>
                  setStaffForm({ ...staffForm, role: e.target.value as 'admin' | 'cashier' })
                }
              >
                <option value="cashier">{t('Cashier')}</option>
                <option value="admin">{t('Administrator')}</option>
              </select>
            </Field>
            <p className="form-help">
              {t(
                'A temporary password will be shown once after the account is created. Share it privately with the staff member.',
              )}
            </p>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setStaffForm(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Create account')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {staffEdit && (
        <Modal title={t('Manage staff member')} onClose={() => setStaffEdit(null)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await run(
                  () => manageStaff({ action: 'update', ...staffEdit }),
                  t('Staff access updated'),
                  ['profiles'],
                )
                setStaffEdit(null)
              } catch {}
            }}
          >
            <Field label={t('Full name')}>
              <input
                required
                value={staffEdit.full_name}
                onChange={(e) => setStaffEdit({ ...staffEdit, full_name: e.target.value })}
              />
            </Field>
            <Field label={t('Role')}>
              <select
                value={staffEdit.role}
                onChange={(e) =>
                  setStaffEdit({ ...staffEdit, role: e.target.value as 'admin' | 'cashier' })
                }
              >
                <option value="cashier">{t('Cashier')}</option>
                <option value="admin">{t('Administrator')}</option>
              </select>
            </Field>
            <label className="check-field">
              <input
                type="checkbox"
                checked={staffEdit.active}
                onChange={(e) => setStaffEdit({ ...staffEdit, active: e.target.checked })}
              />{' '}
              {t('Active access')}
            </label>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setStaffEdit(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('Save access')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {tempPassword && (
        <Modal title={t('Account created')} onClose={() => setTempPassword('')}>
          <div className="password-reveal">
            <div className="success-circle">
              <Check size={26} />
            </div>
            <h3>{t('Share this temporary password privately')}</h3>
            <p>{t('It is shown only now. The new staff member can change it after signing in.')}</p>
            <code>{tempPassword}</code>
            <Button onClick={() => navigator.clipboard.writeText(tempPassword)} variant="secondary">
              {t('Copy password')}
            </Button>
          </div>
          <div className="form-actions">
            <Button onClick={() => setTempPassword('')}>{t('Done')}</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
