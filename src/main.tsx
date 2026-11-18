import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import './motion.css'

// Older installations could save the login password. Clear it even for signed-in users.
try {
  window.localStorage.removeItem('only-us-remember-password')
} catch { /* Storage can be disabled by browser privacy settings. */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
