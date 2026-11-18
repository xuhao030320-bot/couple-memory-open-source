import { describe, expect, it } from 'vitest'
import { checkPublicEnv } from '../../scripts/public-env.mjs'

function fixtureToken(claims: Record<string, unknown>) {
  return ['test', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'fixture'].join('.')
}

describe('public build configuration', () => {
  it.each([
    ['VITE_CLOUDBASE_PUBLISHABLE_KEY', fixtureToken({ is_system_admin: true })],
    ['VITE_CLOUDBASE_ACCESS_KEY', fixtureToken({ is_system_admin: true })],
    ['VITE_SUPABASE_ANON_KEY', fixtureToken({ role: 'service_role' })],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_fixture'],
    ['VITE_DEEPSEEK_API_KEY', 'test-backend-only'],
  ])('stops privileged credentials in %s without printing their value', (name, value) => {
    const check = () => checkPublicEnv({ [name]: value })
    expect(check).toThrow(name)
    expect(check).not.toThrow(value)
  })

  it('accepts public configuration and ignores server-only settings outside Vite', () => {
    expect(() => checkPublicEnv({
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      VITE_SUPABASE_ANON_KEY: fixtureToken({ role: 'anon' }),
      VITE_DATA_PROVIDER: 'local',
      DEEPSEEK_API_KEY: 'server-only-test',
    })).not.toThrow()
  })
})
