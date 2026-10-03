import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2]
if (!file) throw new Error('Usage: node scripts/apply-migration.mjs supabase/migrations/<version>_<name>.sql')
const match = path.basename(file).match(/^(\d{14})_([a-z0-9_]+)\.sql$/)
if (!match) throw new Error('Migration filename must use a 14-digit version and a snake_case name')
const [_, version, name] = match
const ref = 'axvdsnsilgstkriqzjqy'
const token = fs.readFileSync('.secrets/supabase-access-token','utf8').trim()
const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`

async function query(sql, readOnly = false) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || `Management API returned ${response.status}`)
  return body
}

const history = await query(`select version from supabase_migrations.schema_migrations where version = '${version}'`, true)
if (history.length) {
  console.log(`Migration ${version} is already recorded as applied.`)
  process.exit(0)
}
await query(fs.readFileSync(file,'utf8'))
await query(`insert into supabase_migrations.schema_migrations(version,name) values ('${version}','${name}')`)
console.log(`Applied and recorded ${version}_${name} on project ${ref}.`)
