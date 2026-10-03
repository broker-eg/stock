import fs from 'node:fs'
import { chromium } from 'playwright-core'

const credentials = Object.fromEntries(
  fs
    .readFileSync('.secrets/admin-login', 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split('=')),
)
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('requestfailed', (request) => {
  if (request.url().includes('/stock/') || request.url().includes('127.0.0.1'))
    errors.push(`Request failed: ${request.url()}`)
})
const base = process.env.STOCK_DESK_URL ?? 'http://127.0.0.1:5187/'

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'العربية' }).click()
  if ((await page.locator('html').getAttribute('dir')) !== 'rtl')
    throw new Error('Arabic did not set RTL')
  await page.getByRole('heading', { name: 'سجّل الدخول إلى مساحة عملك' }).waitFor()
  await page.screenshot({ path: '/tmp/stock-arabic-login.png', fullPage: true })

  await page.locator('input[type=email]').fill(credentials.email)
  await page.locator('input[type=password]').fill(credentials.password)
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
  await page.locator('.page-heading h1').waitFor({ timeout: 30000 })
  await page.screenshot({ path: '/tmp/stock-arabic-dashboard.png', fullPage: true })

  const headings = []
  for (let index = 0; index < 8; index++) {
    await page.locator('.sidebar nav .nav-link').nth(index).click()
    const heading = await page.locator('.page-heading h1').innerText()
    headings.push(heading)
    if (index === 1) await page.screenshot({ path: '/tmp/stock-arabic-pos.png', fullPage: true })
    if (index === 5) {
      await page.screenshot({ path: '/tmp/stock-arabic-finance.png', fullPage: true })
      const addAccount = page.getByRole('button', { name: 'حساب جديد' })
      await addAccount.click()
      if ((await page.locator('.modal select option[value="asset"]').innerText()) !== 'أصل')
        throw new Error('Account type was not translated')
      await page.keyboard.press('Escape')
      if (await page.locator('.modal').count()) throw new Error('Escape did not close the modal')
      if (!(await addAccount.evaluate((element) => element === document.activeElement)))
        throw new Error('Modal did not restore focus')
    }
    if (index === 6) {
      await page.screenshot({ path: '/tmp/stock-arabic-reports.png', fullPage: true })
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'تصدير CSV' }).click()
      const download = await downloadPromise
      if (download.suggestedFilename() !== 'تقرير-المبيعات.csv')
        throw new Error('CSV filename was not localized')
      const csvPath = '/tmp/stock-arabic-report.csv'
      await download.saveAs(csvPath)
      const content = fs.readFileSync(csvPath, 'utf8')
      if (!content.startsWith('\uFEFF') || !content.includes('المبيعات'))
        throw new Error('CSV content was not localized')
      await page.getByRole('button', { name: 'رصيد المخزون وتقييمه' }).click()
      await page.locator('.loading-line').waitFor({ state: 'hidden' })
      await page.locator('input[type=date]').first().fill('2025-01-01')
      if (await page.getByRole('button', { name: 'تصدير CSV' }).isEnabled())
        throw new Error('Stale stock report could be exported')
      await page.getByRole('button', { name: 'تطبيق الفلاتر' }).click()
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          item.textContent?.includes('تصدير CSV'),
        )
        return button && !button.disabled
      })
      if (!(await page.getByRole('button', { name: 'تصدير CSV' }).isEnabled()))
        throw new Error('Applied stock report could not be exported')
    }
    if (index === 7) {
      await page.screenshot({ path: '/tmp/stock-arabic-settings.png', fullPage: true })
      await page.locator('.file-picker input').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      await page.locator('.file-picker-name').getByText('logo.png').waitFor()
      await page.getByRole('button', { name: 'صلاحيات الفريق' }).click()
      await page.getByRole('button', { name: 'إضافة موظف' }).click()
      await page.screenshot({ path: '/tmp/stock-arabic-staff-form.png', fullPage: true })
      await page.keyboard.press('Escape')
      if (await page.locator('.modal').count()) throw new Error('Escape did not close staff modal')
    }
  }

  await page.getByRole('button', { name: 'English' }).click()
  if ((await page.locator('html').getAttribute('dir')) !== 'ltr')
    throw new Error('English did not set LTR')
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.getByRole('button', { name: 'Reports', exact: true }).click()
  await page.goBack()
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  if ((await page.locator('html').getAttribute('lang')) !== 'en')
    throw new Error('English did not persist')
  await page.getByRole('button', { name: 'العربية' }).click()
  await page.reload({ waitUntil: 'networkidle' })
  if ((await page.locator('html').getAttribute('lang')) !== 'ar')
    throw new Error('Arabic did not persist')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.menu-button').click()
  await page.getByRole('button', { name: 'نقطة البيع' }).click()
  await page.locator('.menu-button').click()
  await page.screenshot({ path: '/tmp/stock-arabic-mobile.png', fullPage: true })
  const sidebar = await page.locator('.sidebar').boundingBox()
  await page.locator('.close-mobile').click()
  await page.screenshot({ path: '/tmp/stock-arabic-pos-mobile.png', fullPage: true })
  const mobileOverflows = []
  for (let index = 0; index < 8; index++) {
    await page.locator('.menu-button').click()
    await page.locator('.sidebar nav .nav-link').nth(index).click()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    if (overflow) mobileOverflows.push(index)
    if (index === 2) {
      await page.getByRole('button', { name: 'إضافة منتج' }).click()
      await page.screenshot({ path: '/tmp/stock-arabic-product-form.png', fullPage: true })
      await page.locator('.modal-head .icon-button').click()
    }
  }
  console.log(JSON.stringify({ headings, mobileOverflows, sidebarX: sidebar?.x, errors }))
  if (errors.length || mobileOverflows.length || !sidebar || sidebar.x < 0) process.exitCode = 1
} finally {
  await browser.close()
}
