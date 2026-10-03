import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import arabicMessages from './locales/ar.json'
import arabicErrors from './locales/errors-ar.json'

export type Locale = 'en' | 'ar'

const preferenceKey = 'stock-desk-language'
const initialLocale = (): Locale => {
  try {
    const saved = localStorage.getItem(preferenceKey)
    if (saved === 'en' || saved === 'ar') return saved
  } catch {
    /* Storage may be disabled. */
  }
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

let activeLocale: Locale = initialLocale()
const LocaleContext = createContext<{ locale: Locale; setLocale: (next: Locale) => void } | null>(
  null,
)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(activeLocale)
  useLayoutEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.title = locale === 'ar' ? 'ستوك ديسك' : 'Stock Desk'
    document.querySelectorAll('input, select, textarea').forEach((element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      )
        element.setCustomValidity('')
    })
  }, [locale])
  useEffect(() => {
    const onInvalid = (event: Event) => {
      if (activeLocale !== 'ar') return
      const field = event.target
      if (!(
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ))
        return
      if (field.validity.valueMissing) field.setCustomValidity('يرجى ملء هذا الحقل.')
      else if (field.validity.typeMismatch) field.setCustomValidity('يرجى إدخال قيمة صحيحة.')
      else if (field.validity.rangeUnderflow) field.setCustomValidity('القيمة أقل من الحد المسموح.')
      else if (field.validity.rangeOverflow) field.setCustomValidity('القيمة أكبر من الحد المسموح.')
      else if (field.validity.stepMismatch) field.setCustomValidity('يرجى إدخال قيمة بخطوة صحيحة.')
      else field.setCustomValidity('يرجى مراجعة هذا الحقل.')
    }
    const onInput = (event: Event) => {
      const field = event.target
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      )
        field.setCustomValidity('')
    }
    document.addEventListener('invalid', onInvalid, true)
    document.addEventListener('input', onInput, true)
    return () => {
      document.removeEventListener('invalid', onInvalid, true)
      document.removeEventListener('input', onInput, true)
    }
  }, [])
  const setLocale = (next: Locale) => {
    activeLocale = next
    try {
      localStorage.setItem(preferenceKey, next)
    } catch {
      /* Storage may be disabled. */
    }
    updateLocale(next)
  }
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('LocaleProvider is missing')
  return value
}

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale()
  return (
    <div
      className={`language-switch ${compact ? 'compact' : ''}`}
      role="group"
      aria-label={t('Language')}
    >
      <button
        type="button"
        lang="en"
        dir="ltr"
        aria-pressed={locale === 'en'}
        onClick={() => setLocale('en')}
      >
        English
      </button>
      <button
        type="button"
        lang="ar"
        dir="rtl"
        aria-pressed={locale === 'ar'}
        onClick={() => setLocale('ar')}
      >
        العربية
      </button>
    </div>
  )
}

// English source phrases are stable message IDs. The locale audit checks every t() call.
export const arabic: Record<string, string> = arabicMessages

export function t(source: string, values: Record<string, string | number> = {}) {
  const message = activeLocale === 'ar' ? (arabic[source] ?? source) : source
  return message.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    return typeof value === 'number' ? formatNumber(value) : String(value ?? '')
  })
}

export function localeTag() {
  return activeLocale === 'ar' ? 'ar-EG' : 'en-US'
}
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(localeTag(), { maximumFractionDigits: 3, ...options }).format(
    Number(value) || 0,
  )
}
export function formatCurrency(value: number, code = 'USD') {
  try {
    return new Intl.NumberFormat(localeTag(), {
      style: 'currency',
      currency: code || 'USD',
      currencyDisplay: activeLocale === 'ar' ? 'name' : 'symbol',
      maximumFractionDigits: 2,
    }).format(Number(value) || 0)
  } catch {
    return `${formatNumber(value, { maximumFractionDigits: 2 })} ${code}`
  }
}
export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
) {
  return new Intl.DateTimeFormat(localeTag(), options).format(new Date(value))
}

export function localizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (activeLocale === 'en') return message
  if (/invalid login credentials|invalid email or password/i.test(message))
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  if (/email not confirmed/i.test(message)) return 'يجب تأكيد البريد الإلكتروني قبل تسجيل الدخول.'
  if (/password should be at least/i.test(message)) return 'كلمة المرور قصيرة جدًا.'
  if (/network|fetch|failed to fetch/i.test(message))
    return 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وأعد المحاولة.'
  if (/rate limit|too many requests/i.test(message))
    return 'طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.'
  const translated = Object.entries(arabicErrors)
    .sort(([a], [b]) => b.length - a.length)
    .find(
      ([english]) => message === english || (english.endsWith(' ') && message.startsWith(english)),
    )
  if (translated) return translated[1] + message.slice(translated[0].length)
  return 'تعذّر إكمال العملية. راجع المدخلات وأعد المحاولة.'
}
