import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3,
  Boxes,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ContactRound,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings,
  ShoppingBag,
  ShoppingCart,
  X,
} from 'lucide-react'
import { db, loadData, type AppData, type AppDataKey, type Profile } from './lib/db'
import { Button } from './components/ui'
import { LanguageSwitch, formatDate, localizeError, t, useLocale } from './i18n'
import {
  Dashboard,
  Inventory,
  Transactions,
  Contacts,
  Finance,
  Reports,
  SettingsPage,
} from './pages'

export type PageProps = {
  data: AppData
  profile: Profile
  run: (work: () => Promise<unknown>, success?: string, changed?: AppDataKey[]) => Promise<unknown>
  busy: boolean
  navigate: (page: Page) => void
}
type Page =
  'dashboard' | 'pos' | 'inventory' | 'purchases' | 'contacts' | 'finance' | 'reports' | 'settings'
const pages: Page[] = [
  'dashboard',
  'pos',
  'inventory',
  'purchases',
  'contacts',
  'finance',
  'reports',
  'settings',
]
const pageFromHash = (): Page => {
  const value = window.location.hash.replace(/^#\/?/, '')
  return pages.includes(value as Page) ? (value as Page) : 'dashboard'
}

const nav: { id: Page; label: string; icon: typeof LayoutDashboard; admin?: boolean }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'pos', label: 'Point of sale', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventory', icon: Boxes, admin: true },
  { id: 'purchases', label: 'Purchasing', icon: ShoppingBag, admin: true },
  { id: 'contacts', label: 'Contacts', icon: ContactRound, admin: true },
  { id: 'finance', label: 'Accounts & staff', icon: CreditCard, admin: true },
  { id: 'reports', label: 'Reports', icon: BarChart3, admin: true },
  { id: 'settings', label: 'Settings', icon: Settings, admin: true },
]

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login-screen">
      <div className="login-art">
        <div className="login-mark">
          <Boxes size={28} />
        </div>
        <div>
          <span className="eyebrow light">{t('STOCK DESK')}</span>
          <h1>
            {t('Good business')}
            <br />
            {t('starts with clarity.')}
          </h1>
          <p>{t('Keep every sale, shelf and balance in view.')}</p>
        </div>
        <div className="login-art-bottom">{t('Sales · Inventory · Accounts')}</div>
      </div>
      <div className="login-panel">
        <div className="login-language">
          <LanguageSwitch />
        </div>
        <div className="login-form">
          <div className="mobile-brand">
            <Boxes size={25} /> {t('Stock Desk')}
          </div>
          <span className="eyebrow">{t('WELCOME BACK')}</span>
          <h2>{t('Sign in to your workspace')}</h2>
          <p>{t('Use the account provided by your administrator.')}</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError('')
              try {
                const { error } = await db.auth.signInWithPassword({ email, password })
                if (error) setError(error.message)
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error))
              } finally {
                setBusy(false)
              }
            }}
          >
            <label>
              {t('Email address')}
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@business.com"
              />
            </label>
            <label>
              {t('Password')}
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('Your password')}
              />
            </label>
            {error && <div className="form-error">{localizeError(error)}</div>}
            <Button type="submit" disabled={busy} className="full-width">
              {busy ? t('Signing in…') : t('Sign in')}
            </Button>
          </form>
          <div className="login-foot">{t('A quieter way to run the day.')}</div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { locale } = useLocale()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AppData | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [page, setPage] = useState<Page>(pageFromHash)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarSmall, setSidebarSmall] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; error: boolean; retry?: () => void } | null>(
    null,
  )
  const [loadError, setLoadError] = useState('')
  const dataRef = useRef<AppData | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => setToast(null), [locale])
  const refresh = useCallback(async (userId: string, changed?: AppDataKey[]) => {
    const loaded = await loadData(dataRef.current || undefined, changed)
    dataRef.current = loaded
    setData(loaded)
    setProfile(loaded.profiles.find((p) => p.user_id === userId) || null)
  }, [])
  useEffect(() => {
    db.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error
        setSession(data.session)
        setLoading(false)
      })
      .catch((error) => {
        setLoadError(localizeError(error))
        setLoading(false)
      })
    const { data: listener } = db.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        dataRef.current = null
        setData(null)
        setProfile(null)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    if (!sidebarOpen) return
    const sidebar = sidebarRef.current
    const focusable = () => [
      ...(sidebar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []),
    ]
    sidebar?.querySelector<HTMLButtonElement>('.close-mobile')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault()
        items[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      menuButtonRef.current?.focus()
    }
  }, [sidebarOpen])
  useEffect(() => {
    if (!session) return
    setLoading(true)
    refresh(session.user.id)
      .then(() => setLoadError(''))
      .catch((e) => setLoadError(localizeError(e)))
      .finally(() => setLoading(false))
  }, [session?.user.id, refresh])
  useEffect(() => {
    if (toast && !toast.retry) {
      const timer = setTimeout(() => setToast(null), 4800)
      return () => clearTimeout(timer)
    }
  }, [toast])
  async function retryRefresh() {
    if (!session) return
    try {
      await refresh(session.user.id)
      setLoadError('')
      setToast(null)
    } catch (error) {
      setToast({
        text: localizeError(error),
        error: true,
        retry: () => {
          void retryRefresh()
        },
      })
    }
  }
  async function retryWorkspace() {
    setLoading(true)
    try {
      const { data: auth, error } = await db.auth.getSession()
      if (error) throw error
      setSession(auth.session)
      if (auth.session && auth.session.user.id === session?.user.id)
        await refresh(auth.session.user.id)
      setLoadError('')
    } catch (error) {
      setLoadError(localizeError(error))
    } finally {
      setLoading(false)
    }
  }
  async function run(
    work: () => Promise<unknown>,
    success = t('Saved successfully'),
    changed?: AppDataKey[],
  ) {
    setBusy(true)
    try {
      const result = await work()
      try {
        if (session) await refresh(session.user.id, changed)
        setToast({ text: success, error: false })
      } catch {
        setToast({
          text: t('Saved, but the workspace could not refresh.'),
          error: true,
          retry: () => {
            void retryRefresh()
          },
        })
      }
      return result
    } catch (e) {
      setToast({ text: localizeError(e), error: true })
      throw e
    } finally {
      setBusy(false)
    }
  }
  function navigate(next: Page) {
    setPage(next)
    window.location.hash = `/${next}`
    setSidebarOpen(false)
    window.scrollTo(0, 0)
  }
  if (loading)
    return (
      <div className="splash">
        <div className="splash-logo">
          <Boxes size={29} />
        </div>
        <span>{t('Loading your workspace…')}</span>
      </div>
    )
  if (loadError && (!data || !profile))
    return (
      <div className="access-screen">
        <LanguageSwitch />
        <Boxes size={34} />
        <h1>{t('Could not load your workspace')}</h1>
        <p>{loadError}</p>
        <Button
          onClick={() => {
            void retryWorkspace()
          }}
          variant="secondary"
        >
          {t('Retry')}
        </Button>
      </div>
    )
  if (!session) return <Login />
  if (!data || !profile || !profile.active)
    return (
      <div className="access-screen">
        <LanguageSwitch />
        <Boxes size={34} />
        <h1>{t('Account pending')}</h1>
        <p>
          {t('Your account has no active Stock Desk role. Ask an administrator to grant access.')}
        </p>
        <Button onClick={() => db.auth.signOut()} variant="secondary">
          {t('Sign out')}
        </Button>
      </div>
    )
  const props: PageProps = { data, profile, run, busy, navigate }
  const visibleNav = nav.filter((n) => !n.admin || profile.role === 'admin')
  const activePage = visibleNav.some((item) => item.id === page) ? page : 'dashboard'
  return (
    <div className={`app-shell ${sidebarSmall ? 'sidebar-small' : ''}`}>
      {sidebarOpen && (
        <button
          className="mobile-overlay"
          aria-label={t('Close menu')}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside ref={sidebarRef} className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-icon">
            <Boxes size={22} />
          </div>
          <div className="brand-copy">
            <strong>{t('Stock Desk')}</strong>
            <span>{t('BUSINESS WORKSPACE')}</span>
          </div>
          <button
            className="close-mobile"
            aria-label={t('Close menu')}
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar">{data.settings.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{data.settings.name}</strong>
            <span>{t('Workspace')}</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">{t('WORKSPACE')}</div>
        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-link ${activePage === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                title={t(item.label)}
              >
                <Icon size={19} />
                <span>{t(item.label)}</span>
                {activePage === item.id && <i />}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <CircleHelp size={19} />
            <div>
              <strong>{t('Everything in its place')}</strong>
              <p>{t('Your figures update as you work.')}</p>
            </div>
          </div>
          <button className="collapse-link" onClick={() => setSidebarSmall(!sidebarSmall)}>
            <PanelLeftClose size={18} />
            <span>{sidebarSmall ? t('Expand menu') : t('Collapse menu')}</span>
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="menu-button"
            aria-label={t('Open menu')}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-path">
            <span>{t('Workspace')}</span>
            <span className="path-slash">/</span>
            <strong>{t(visibleNav.find((n) => n.id === activePage)?.label || '')}</strong>
          </div>
          <div className="topbar-right">
            <div className="today-label">
              <ClipboardList size={16} />
              {formatDate(new Date().toISOString(), {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </div>
            <LanguageSwitch compact />
            <div className="user-pill">
              <div className="user-avatar">{profile.full_name.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{profile.full_name}</strong>
                <span>{t(profile.role)}</span>
              </div>
            </div>
            <button
              className="icon-button signout"
              onClick={() => db.auth.signOut()}
              title={t('Sign out')}
              aria-label={t('Sign out')}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="page-content">
          {activePage === 'dashboard' && <Dashboard {...props} />}
          {activePage === 'pos' && <Transactions {...props} mode="sale" />}
          {activePage === 'inventory' && <Inventory {...props} />}
          {activePage === 'purchases' && <Transactions {...props} mode="purchase" />}
          {activePage === 'contacts' && <Contacts {...props} />}
          {activePage === 'finance' && <Finance {...props} />}
          {activePage === 'reports' && <Reports {...props} />}
          {activePage === 'settings' && <SettingsPage {...props} />}
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? 'toast-error' : ''}`}>
          {toast.text}
          {toast.retry && <button onClick={toast.retry}>{t('Retry refresh')}</button>}
          <button onClick={() => setToast(null)} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
