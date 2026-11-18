import { describe, expect, it } from 'vitest'
import type { MessageItem } from '../types'
import {
  filterVisibleMessages,
  shouldPropagateCloudbaseAuthEvent,
  toAnniversary,
  toMemory,
  toMessage,
  toWish,
} from './providers/cloudbase'

function message(overrides: Partial<MessageItem>): MessageItem {
  return {
    id: 'm1',
    text: '想你了',
    revealAt: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    createdBy: 'u_me',
    ...overrides,
  }
}

describe('cloudbase message visibility filter', () => {
  it('hides the partner pending message and keeps revealed ones', () => {
    const messages = [
      message({ id: '1', revealAt: null, createdBy: 'u_partner' }),
      message({ id: '2', revealAt: '2099-01-01T00:00:00.000Z', createdBy: 'u_partner' }),
      message({ id: '3', revealAt: '2020-01-01T00:00:00.000Z', createdBy: 'u_partner' }),
      message({ id: '4', revealAt: '2099-01-01T00:00:00.000Z', createdBy: 'u_me' }),
    ]
    const visible = filterVisibleMessages(messages, 'u_me')
    expect(visible.map((item) => item.id)).toEqual(['1', '3', '4'])
  })

  it('fails closed for an invalid revealAt from the partner', () => {
    const visible = filterVisibleMessages(
      [message({ id: '1', revealAt: 'not-a-date', createdBy: 'u_partner' })],
      'u_me',
    )
    expect(visible).toHaveLength(0)
  })
})

describe('cloudbase auth events', () => {
  const session = {
    user: {
      id: 'u_test',
      user_metadata: {},
    },
  }

  it('ignores a refresh credential error with no session', () => {
    expect(shouldPropagateCloudbaseAuthEvent('CREDENTIALS_ERROR', null)).toBe(false)
  })

  it('only clears the app session for an explicit sign-out', () => {
    expect(shouldPropagateCloudbaseAuthEvent('SIGNED_OUT', null)).toBe(true)
  })

  it('keeps a valid session when its token is refreshed', () => {
    expect(shouldPropagateCloudbaseAuthEvent('TOKEN_REFRESHED', session)).toBe(true)
  })
})

describe('cloudbase doc mapping', () => {
  it('maps a memories doc with fileID-first photo resolution', () => {
    const memory = toMemory({
      _id: 'mem-1',
      title: '第一次旅行',
      originalText: '海边',
      displayText: '海边',
      date: '2026-05-20',
      location: '厦门',
      style: 'cream',
      template: 'hero-note',
      tags: [],
      category: 'travel',
      moodEmoji: '🌊',
      moodText: '',
      isDemo: false,
      isLiked: true,
      createdAt: '2026-05-21T10:00:00.000Z',
      photos: [
        {
          id: 'p1',
          fileID: 'cloud://env.bucket/couple-photos/cp_x/mem-1/p1.jpg',
          src: 'cloud://env.bucket/couple-photos/cp_x/mem-1/p1.jpg',
          name: 'a.jpg',
          alt: '',
          caption: '',
          order: 0,
          role: 'cover',
          focusX: 0.5,
          focusY: 0.5,
          kind: 'image',
          mimeType: 'image/jpeg',
        },
        {
          id: 'p2',
          src: 'cloud://env.bucket/couple-photos/cp_x/mem-1/p2.mp4',
          name: 'v.mp4',
          alt: '',
          caption: '',
          order: 1,
          role: 'supporting',
          focusX: 0.5,
          focusY: 0.5,
          kind: 'video',
          mimeType: 'video/mp4',
        },
      ],
    })

    expect(memory.id).toBe('mem-1')
    expect(memory.isLiked).toBe(true)
    expect(memory.photos).toHaveLength(2)
    // fileID 优先于 src 兜底，两种写入形态都能读出 fileID
    expect(memory.photos[0].src).toBe('cloud://env.bucket/couple-photos/cp_x/mem-1/p1.jpg')
    expect(memory.photos[1].src).toBe('cloud://env.bucket/couple-photos/cp_x/mem-1/p2.mp4')
    expect(memory.photos[1].kind).toBe('video')
  })

  it('maps wishes/anniversaries/messages docs to camelCase models', () => {
    const wish = toWish({
      _id: 'w1', text: '去冰岛', completed: true, category: 'daily',
      createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'u_me',
    })
    expect(wish).toMatchObject({ id: 'w1', text: '去冰岛', completed: true, category: 'daily' })
    expect(toWish({ _id: 'w-food', text: '吃烤鸭', category: 'food' }).category).toBe('food')

    const anniversary = toAnniversary({
      _id: 'a1', title: '在一起', date: '2025-02-14', repeatsYearly: true, kind: 'love',
      note: '', createdAt: new Date('2025-02-14T08:00:00.000Z'),
    })
    expect(anniversary).toMatchObject({ id: 'a1', title: '在一起', repeatsYearly: true, kind: 'love' })
    expect(anniversary.createdAt).toBe('2025-02-14T08:00:00.000Z')

    const messageItem = toMessage({
      _id: 'm1', text: '晚安', revealAt: null,
      createdAt: new Date('2026-08-15T00:00:00.000Z'), createdBy: 'u_me',
    })
    expect(messageItem).toMatchObject({ id: 'm1', text: '晚安', revealAt: null })
  })
})
