import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const secret = Deno.env.get('STOCK_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !secret) return json({ error: 'Staff service is not configured' }, 503)
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return json({ error: 'Sign in required' }, 401)
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user || auth.user.is_anonymous) return json({ error: 'Invalid session' }, 401)
  const { data: operator, error: operatorError } = await admin.from('profiles')
    .select('role,active').eq('user_id', auth.user.id).single()
  if (operatorError || operator?.role !== 'admin' || !operator.active) return json({ error: 'Administrator access required' }, 403)
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const action = String(body.action || '')
  const fullName = String(body.full_name || '').trim()
  const role = String(body.role || '')
  if (!fullName || fullName.length > 120 || !['admin','cashier'].includes(role)) return json({ error: 'Valid name and role are required' }, 400)

  if (action === 'create') {
    const email = String(body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return json({ error: 'Valid email is required' }, 400)
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    const password = btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (createError || !created.user) return json({ error: createError?.message || 'Could not create user' }, 400)
    const { error: profileError } = await admin.from('profiles').insert({
      user_id: created.user.id, full_name: fullName, role, active: true,
    })
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: profileError.message }, 400)
    }
    return json({ user_id: created.user.id, temporary_password: password }, 201)
  }

  if (action === 'update') {
    const userId = String(body.user_id || '')
    if (!/^[0-9a-f-]{36}$/i.test(userId) || typeof body.active !== 'boolean') return json({ error: 'Valid user and status are required' }, 400)
    const { data: target, error: targetError } = await admin.from('profiles').select('role,active').eq('user_id', userId).single()
    if (targetError || !target) return json({ error: 'Staff member not found' }, 404)
    if (target.role === 'admin' && target.active && (role !== 'admin' || !body.active)) {
      const { count, error: countError } = await admin.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role','admin').eq('active',true)
      if (countError || (count || 0) <= 1) return json({ error: 'Keep at least one active administrator' }, 400)
    }
    const { error } = await admin.from('profiles').update({ full_name: fullName, role, active: body.active }).eq('user_id', userId)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
