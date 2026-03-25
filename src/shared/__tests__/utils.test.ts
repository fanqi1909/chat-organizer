import { describe, it, expect } from 'vitest'
import { extractConversationId, truncate } from '../utils'

describe('extractConversationId', () => {
  it('extracts UUID from /chat/ path', () => {
    expect(extractConversationId('/chat/abc-123-def')).toBe('abc-123-def')
  })

  it('extracts UUID from /c/ path (ChatGPT style)', () => {
    expect(extractConversationId('/c/abc-123-def')).toBe('abc-123-def')
  })

  it('returns null for unrecognised paths', () => {
    expect(extractConversationId('/new')).toBeNull()
    expect(extractConversationId('')).toBeNull()
    expect(extractConversationId('/settings')).toBeNull()
  })

  it('works with full URLs', () => {
    expect(extractConversationId('https://claude.ai/chat/550e8400-e29b-41d4-a716-446655440000'))
      .toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…')
  })

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('')
  })
})
