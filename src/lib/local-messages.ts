import type { MessageItem } from '../types'
import { getMessages, saveMessages } from './storage'

export function getInitialMessages(cloudMode: boolean): MessageItem[] {
  return cloudMode ? [] : getMessages()
}

/** Read the latest cache so consecutive actions cannot overwrite messages from an older render. */
export function updateLocalMessages(update: (current: MessageItem[]) => MessageItem[]): MessageItem[] {
  const next = update(getMessages())
  saveMessages(next)
  return next
}
