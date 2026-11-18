import { useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'
function subscribe(onChange: () => void) {
  const preference = window.matchMedia(query)
  preference.addEventListener('change', onChange)
  return () => preference.removeEventListener('change', onChange)
}
function snapshot() {
  return window.matchMedia(query).matches
}

/** Follow changes made while the app is open; SSR starts with the quiet presentation. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true)
}
