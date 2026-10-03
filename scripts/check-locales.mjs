import fs from 'node:fs'
import ts from 'typescript'

const arabic = JSON.parse(fs.readFileSync('src/locales/ar.json', 'utf8'))
const files = ['src/App.tsx', 'src/pages.tsx', 'src/components/ui.tsx', 'src/i18n.tsx']
const uiAttributes = new Set([
  'title',
  'subtitle',
  'description',
  'label',
  'placeholder',
  'hint',
  'note',
  'aria-label',
  'alt',
])
const examples = new Set(['you@business.com', 'USD', 'https://…'])
const dynamicKeys = [
  'Overview',
  'Point of sale',
  'Inventory',
  'Purchasing',
  'Contacts',
  'Accounts & staff',
  'Reports',
  'Settings',
  'Sale',
  'Sales return',
  'Quotation',
  'Sales order',
  'Purchase',
  'Purchase return',
  'Purchase order',
  'posted',
  'open',
  'fulfilled',
  'cancelled',
  'customer',
  'supplier',
  'both',
  'admin',
  'cashier',
  'asset',
  'liability',
  'income',
  'expense',
  'equity',
  'present',
  'absent',
  'leave',
  'opening',
  'receipt',
  'issue',
  'damage',
  'count',
  'sale',
  'sale_return',
  'purchase',
  'purchase_return',
  'Cash',
  'Bank',
  'Accounts receivable',
  'Inventory',
  'Input tax',
  'Accounts payable',
  'Output tax',
  'Sales revenue',
  'Cost of goods sold',
  'Purchase price variance',
  'Operating expenses',
  'Salaries',
  'Opening balance',
]
const errors = []
for (const key of dynamicKeys) if (!arabic[key]) errors.push(`Missing dynamic translation: ${key}`)
for (const file of fs.readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql'))) {
  const sql = fs.readFileSync(`supabase/migrations/${file}`, 'utf8')
  for (const match of sql.matchAll(
    /\('[0-9]{4}',\s*'([^']+)',\s*'(?:asset|liability|income|expense|equity)'/g,
  ))
    if (!arabic[match[1]]) errors.push(`Missing built-in account translation: ${match[1]}`)
}
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const line = (node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
  function checkKey(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!arabic[node.text]) errors.push(`${line(node)} missing Arabic: ${node.text}`)
    } else if (ts.isConditionalExpression(node)) {
      checkKey(node.whenTrue)
      checkKey(node.whenFalse)
    }
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments[0]
    )
      checkKey(node.arguments[0])
    if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text) && node.text.trim() !== 'English')
      errors.push(`${line(node)} untranslated JSX text: ${node.text.trim()}`)
    if (
      ts.isJsxAttribute(node) &&
      uiAttributes.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      /[A-Za-z]/.test(node.initializer.text) &&
      !examples.has(node.initializer.text)
    )
      errors.push(`${line(node)} untranslated ${node.name.text}: ${node.initializer.text}`)
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Arabic catalog covers all static UI messages (${Object.keys(arabic).length} translations).`,
  )
}
