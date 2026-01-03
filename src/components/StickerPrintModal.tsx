import PaybillHeader from './PaybillHeader'

type StickerLine = {
  label: string
  value?: string | null
}

type StickerPrintModalProps = {
  open: boolean
  title: string
  lines: StickerLine[]
  note?: string
  onClose: () => void
}

function buildStickerHtml(title: string, lines: StickerLine[], note?: string) {
  const safeLines = lines.filter((line) => line.value)
  const bodyLines = safeLines
    .map(
      (line) => `
        <div class="row">
          <div class="label">${line.label}</div>
          <div class="code">${line.value}</div>
        </div>
      `,
    )
    .join('')

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { font-family: "Sora", "Segoe UI", sans-serif; padding: 24px; color: #0f172a; }
          h2 { margin: 0 0 8px; font-size: 20px; }
          .meta { font-size: 13px; margin-bottom: 12px; }
          .paybill { font-weight: 800; letter-spacing: 0.08em; }
          .row { margin: 12px 0; }
          .label { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }
          .code { font-size: 22px; font-weight: 800; letter-spacing: 0.16em; margin-top: 4px; }
          .note { font-size: 12px; color: #475569; margin-top: 16px; }
          .divider { margin: 14px 0; border-top: 1px dashed #cbd5f5; }
        </style>
      </head>
      <body>
        <h2>${title}</h2>
        <div class="meta">
          <div class="paybill">PAYBILL: 4814003</div>
          <div>Account Number is 7 digits (last digit is checksum). Always type all 7 digits.</div>
        </div>
        <div class="divider"></div>
        ${bodyLines}
        ${note ? `<div class="note">${note}</div>` : ''}
      </body>
    </html>
  `
}

export default function StickerPrintModal({ open, title, lines, note, onClose }: StickerPrintModalProps) {
  if (!open) return null

  const printableLines = lines.filter((line) => line.value)

  const handlePrint = () => {
    const win = window.open('', 'paybill-sticker', 'width=480,height=640')
    if (!win) return
    win.document.open()
    win.document.write(buildStickerHtml(title, printableLines, note))
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 40,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="card" style={{ maxWidth: 520, width: '100%' }}>
        <div className="topline">
          <h3 style={{ margin: 0 }}>Print Sticker</h3>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <PaybillHeader title={title} />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {printableLines.map((line) => (
              <div key={line.label} className="card" style={{ margin: 0, boxShadow: 'none' }}>
                <div className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {line.label}
                </div>
                <div className="paybill-code" style={{ marginTop: 6 }}>
                  {line.value}
                </div>
              </div>
            ))}
          </div>
          {note ? (
            <p className="muted small" style={{ marginTop: 12 }}>
              {note}
            </p>
          ) : null}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn" type="button" onClick={handlePrint}>
            Print
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
