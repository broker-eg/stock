import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X, Plus, ArrowRight, Search } from 'lucide-react'
import { t } from '../i18n'

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  icon,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  icon?: ReactNode
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant} ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}
export function Heading({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </div>
  )
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}
export function Modal({
  title,
  children,
  onClose,
  width = 'normal',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  width?: 'normal' | 'wide'
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = dialog.current
    const focusable = () => [
      ...(node?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
      ) || []),
    ]
    ;(focusable()[0] || node)?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className={`modal modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: () => void
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Plus size={23} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <Button onClick={action} variant="secondary">
          {t('Get started')} <ArrowRight size={15} />
        </Button>
      )}
    </div>
  )
}
export function SearchInput({
  value,
  onChange,
  placeholder = t('Search'),
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="search-input">
      <Search size={17} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
