import { useEffect, useRef, useState } from 'react'

type PaybillCodeCardProps = {
  title?: string
  label?: string
  code?: string | null
  helper?: string
  variant?: 'card' | 'inline'
}

function copyText(value: string) {
  if (!value) return false
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value)
    return true
  }
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = value
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.focus()
  area.select()
  try {
    document.execCommand('copy')
    return true
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}

export default function PaybillCodeCard({
  title,
  label,
  code,
  helper,
  variant = 'card',
}: PaybillCodeCardProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  const displayCode = code || '-'
  const canCopy = Boolean(code)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleCopy = () => {
    if (!canCopy) return
    if (!copyText(code || '')) return
    setCopied(true)
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => setCopied(false), 1800)
  }

  if (variant === 'inline') {
    return (
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {label ? <span className="muted small">{label}</span> : null}
        <span className="mono" style={{ fontWeight: 700 }}>
          {displayCode}
        </span>
        <button className="btn ghost" type="button" onClick={handleCopy} disabled={!canCopy}>
          Copy
        </button>
        {copied ? (
          <span className="muted small" aria-live="polite">
            Copied
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="card" style={{ margin: 0, boxShadow: 'none' }}>
      {title ? <h4 style={{ margin: '0 0 6px' }}>{title}</h4> : null}
      {label ? <span className="paybill-pill">{label}</span> : null}
      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <span className="paybill-code">{displayCode}</span>
        <button className="btn ghost" type="button" onClick={handleCopy} disabled={!canCopy}>
          Copy
        </button>
        {copied ? (
          <span className="muted small" aria-live="polite">
            Copied
          </span>
        ) : null}
      </div>
      {helper ? <div className="muted small">{helper}</div> : null}
    </div>
  )
}
