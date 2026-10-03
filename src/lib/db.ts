import { createClient } from '@supabase/supabase-js'
import { formatCurrency, formatDate, formatNumber } from '../i18n'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY')

export const db = createClient(url, key)

export type Role = 'admin' | 'cashier'
export type Profile = {
  user_id: string
  full_name: string
  role: Role
  active: boolean
  created_at: string
}
export type Settings = {
  id: number
  name: string
  tax_number: string
  currency: string
  address: string
  phone: string
  logo_url: string
}
export type Warehouse = { id: string; name: string; location: string; active: boolean }
export type Product = {
  id: string
  sku: string
  name: string
  base_unit: string
  alternate_unit: string | null
  units_per_alternate: number | null
  selling_price: number
  cost_price: number
  tax_rate: number
  reorder_level: number
  active: boolean
}
export type Party = {
  id: string
  kind: 'customer' | 'supplier' | 'both'
  name: string
  phone: string
  email: string
  tax_number: string
  address: string
}
export type Account = {
  id: string
  code: string
  name: string
  type: string
  is_cash: boolean
  system_key: string | null
  active: boolean
}
export type DocumentLine = {
  id: string
  document_id: string
  product_id: string
  quantity: number
  unit_name: string
  unit_factor: number
  base_quantity: number
  unit_price: number
  discount: number
  tax_rate: number
  net: number
  tax: number
  total: number
  cost_total: number
}
export type Document = {
  id: string
  doc_number: number
  kind: string
  status: string
  party_id: string | null
  warehouse_id: string
  reference_id: string | null
  subtotal: number
  discount: number
  tax_total: number
  total: number
  note: string
  occurred_at: string
  created_by: string
  cancelled_at: string | null
  cancelled_by: string | null
  document_lines: DocumentLine[]
}
export type Balance = { product_id: string; warehouse_id: string; quantity: number; value: number }
export type Movement = {
  id: string
  product_id: string
  warehouse_id: string
  quantity_delta: number
  value_delta: number
  kind: string
  document_id: string | null
  note: string
  occurred_at: string
}
export type Payment = {
  id: string
  party_id: string
  direction: string
  amount: number
  account_id: string
  document_id: string | null
  note: string
  occurred_at: string
}
export type Expense = {
  id: string
  account_id: string
  cash_account_id: string
  description: string
  amount: number
  occurred_at: string
}
export type Attendance = { id: string; staff_id: string; day: string; status: string; note: string }
export type Payroll = {
  id: string
  staff_id: string
  period: string
  gross: number
  cash_account_id: string
  paid_at: string
}
export type JournalLine = {
  id: string
  entry_id: string
  account_id: string
  party_id: string | null
  debit: number
  credit: number
}

export type AppData = {
  settings: Settings
  profiles: Profile[]
  warehouses: Warehouse[]
  products: Product[]
  parties: Party[]
  accounts: Account[]
  documents: Document[]
  balances: Balance[]
  movements: Movement[]
  payments: Payment[]
  expenses: Expense[]
  attendance: Attendance[]
  payroll: Payroll[]
  journalLines: JournalLine[]
}
export type AppDataKey = keyof AppData

const pageSize = 500

async function table<T>(name: string, query = '*', order = 'id'): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from(name)
      .select(query)
      .order(order)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...((data || []) as T[]))
    if (!data || data.length < pageSize) return rows
  }
}

async function rpcRows<T>(name: string, order: string, secondary?: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    let query = db.rpc(name).order(order)
    if (secondary) query = query.order(secondary)
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...((data || []) as T[]))
    if (!data || data.length < pageSize) return rows
  }
}

const loaders: { [K in AppDataKey]: () => Promise<AppData[K]> } = {
  settings: async () => {
    const settings = await table<Settings>('business_settings', '*', 'id')
    if (!settings[0]) throw new Error('Business settings are missing')
    return settings[0]
  },
  profiles: () => table<Profile>('profiles', '*', 'user_id'),
  warehouses: () => table<Warehouse>('warehouses'),
  products: () => rpcRows<Product>('catalog', 'id'),
  parties: () => table<Party>('parties'),
  accounts: () => table<Account>('accounts'),
  documents: async () =>
    (await table<Document>('documents', '*,document_lines(*)')).sort(
      (a, b) => b.doc_number - a.doc_number,
    ),
  balances: () => rpcRows<Balance>('stock_quantities', 'product_id', 'warehouse_id'),
  movements: () => table<Movement>('stock_movements'),
  payments: () => table<Payment>('payments'),
  expenses: () => table<Expense>('expenses'),
  attendance: () => table<Attendance>('attendance'),
  payroll: () => table<Payroll>('payroll'),
  journalLines: () => table<JournalLine>('journal_lines'),
}

export async function loadData(previous?: AppData, changed?: AppDataKey[]): Promise<AppData> {
  const keys = changed || (Object.keys(loaders) as AppDataKey[])
  const loaded = await Promise.all(keys.map(async (key) => [key, await loaders[key]()] as const))
  return { ...previous, ...Object.fromEntries(loaded) } as AppData
}

export async function saveRow(tableName: string, values: Record<string, unknown>, id?: string) {
  const q = id ? db.from(tableName).update(values).eq('id', id) : db.from(tableName).insert(values)
  const { error } = await q
  if (error) throw error
}

export async function call<T = string>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args)
  if (error) throw error
  return data as T
}

export function currency(value: number, code = 'USD') {
  return formatCurrency(value, code)
}
export function number(value: number) {
  return formatNumber(value)
}
export function date(value: string) {
  return formatDate(value)
}
export function localDay(value: string) {
  return new Date(value).toLocaleDateString('sv-SE')
}
export function monthKey(value: string) {
  return localDay(value).slice(0, 7)
}
export function today() {
  return localDay(new Date().toISOString())
}

export function customerBalance(data: AppData, party: Party) {
  const documents = data.documents.filter((d) => d.party_id === party.id && d.status === 'posted')
  const payments = data.payments.filter((p) => p.party_id === party.id)
  return (
    documents.reduce(
      (sum, d) =>
        sum + (d.kind === 'sale' ? 1 : d.kind === 'sale_return' ? -1 : 0) * Number(d.total),
      0,
    ) -
    payments.reduce(
      (sum, p) =>
        sum +
        (p.direction === 'receipt'
          ? Number(p.amount)
          : p.direction === 'refund_customer'
            ? -Number(p.amount)
            : 0),
      0,
    )
  )
}
export function supplierBalance(data: AppData, party: Party) {
  const documents = data.documents.filter((d) => d.party_id === party.id && d.status === 'posted')
  const payments = data.payments.filter((p) => p.party_id === party.id)
  return (
    documents.reduce(
      (sum, d) =>
        sum + (d.kind === 'purchase' ? 1 : d.kind === 'purchase_return' ? -1 : 0) * Number(d.total),
      0,
    ) -
    payments.reduce(
      (sum, p) =>
        sum +
        (p.direction === 'payment'
          ? Number(p.amount)
          : p.direction === 'refund_supplier'
            ? -Number(p.amount)
            : 0),
      0,
    )
  )
}
export function partyBalance(data: AppData, party: Party) {
  return customerBalance(data, party) - supplierBalance(data, party)
}

export function exportCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
