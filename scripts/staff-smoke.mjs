import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').trim().split('\n').map(line => line.split('=')))
const login = Object.fromEntries(fs.readFileSync('.secrets/admin-login','utf8').trim().split('\n').map(line => line.split('=')))
const url = env.VITE_SUPABASE_URL
const admin = createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY)
const service = createClient(url, fs.readFileSync('.secrets/supabase-secret-key','utf8').trim(), { auth: { persistSession: false, autoRefreshToken: false } })
const { error: loginError } = await admin.auth.signInWithPassword(login)
if (loginError) throw loginError

let createdId
try {
  const email = `smoke-${crypto.randomUUID()}@example.invalid`
  const { data, error } = await admin.functions.invoke('manage-staff', {
    body: { action:'create', email, full_name:'Smoke Cashier', role:'cashier' },
  })
  if (error || !data?.user_id) throw new Error(`Staff create failed: ${error?.message || JSON.stringify(data)}`)
  createdId = data.user_id
  const cashier = createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const { error: staffLoginError } = await cashier.auth.signInWithPassword({ email, password: data.temporary_password })
  if (staffLoginError) throw staffLoginError
  const { data: ownProfile, error: profileError } = await cashier.from('profiles').select('role,active').eq('user_id',createdId).single()
  if (profileError || ownProfile?.role !== 'cashier' || !ownProfile.active) throw new Error('Cashier profile unavailable')
  const { error: forbidden } = await cashier.rpc('post_document', {
    p_kind:'purchase', p_party:null, p_warehouse:'00000000-0000-0000-0000-000000000000', p_lines:[],
  })
  if (!forbidden?.message.includes('Administrator access required')) throw new Error(`Cashier purchase was not blocked: ${forbidden?.message}`)
  const nil = '00000000-0000-0000-0000-000000000000'
  const { error: refundForbidden } = await cashier.rpc('record_payment', {
    p_party: nil, p_direction: 'refund_customer', p_amount: 1, p_account: nil,
  })
  if (!refundForbidden?.message.includes('Administrator access required')) throw new Error(`Cashier refund was not blocked: ${refundForbidden?.message}`)
  const { error: cancelForbidden } = await cashier.rpc('cancel_open_document', { p_document: nil })
  if (!cancelForbidden?.message.includes('Administrator access required')) throw new Error(`Cashier cancellation was not blocked: ${cancelForbidden?.message}`)
  const { data: updated, error: updateError } = await admin.functions.invoke('manage-staff', {
    body: { action:'update', user_id:createdId, full_name:'Smoke Cashier', role:'cashier', active:false },
  })
  if (updateError || !updated?.ok) throw new Error(`Staff update failed: ${updateError?.message || JSON.stringify(updated)}`)
  const { data: disabled } = await service.from('profiles').select('active').eq('user_id',createdId).single()
  if (disabled?.active !== false) throw new Error('Staff disable failed')
  console.log('Staff creation, cashier login, purchase/refund/cancellation denial, and access disable passed')
} finally {
  if (createdId) {
    const { error } = await service.auth.admin.deleteUser(createdId)
    if (error) throw error
  }
  await admin.auth.signOut()
}
