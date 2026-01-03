import { PAYBILL_HELP, PAYBILL_NUMBER } from '../lib/paybill'

type PaybillHeaderProps = {
  title: string
  actions?: React.ReactNode
}

export default function PaybillHeader({ title, actions }: PaybillHeaderProps) {
  return (
    <div>
      <div className="topline">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {actions || null}
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
        <span className="mono" style={{ fontWeight: 700 }}>
          PAYBILL: {PAYBILL_NUMBER}
        </span>
        <span className="muted small">{PAYBILL_HELP}</span>
      </div>
    </div>
  )
}
