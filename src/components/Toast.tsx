import { CheckCircle2, X } from 'lucide-react'

interface ToastProps {
  message: string
  onClose: () => void
  action?: { label: string; onClick: () => void }
}

export function Toast({ message, onClose, action }: ToastProps) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      <CheckCircle2 size={18} />
      <span>{message}</span>
      {action && <button className="toast-action" type="button" onClick={action.onClick}>{action.label}</button>}
      <button type="button" aria-label="关闭提示" onClick={onClose}><X size={15} /></button>
    </div>
  )
}
