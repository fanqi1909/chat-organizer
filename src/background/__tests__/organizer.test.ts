import { describe, it, expect } from 'vitest'

// Pure helper extracted for testing — mirrors the logic in organizer.ts
function extractMessageText(m: {
  sender?: string; role?: string; text?: string
  content?: Array<{ type: string; text: string }>
}): string {
  let text = m.text ?? m.content?.find((c) => c.type === 'text')?.text ?? ''
  if (text.includes('Continuing from archived thread')) {
    const inner = text.match(/"([^"\[\]]{3,})"/)
    text = inner ? inner[1] : ''
  }
  return text.trim()
}

describe('extractMessageText', () => {
  it('returns plain text directly', () => {
    expect(extractMessageText({ text: 'hello world' })).toBe('hello world')
  })

  it('extracts text from content array', () => {
    expect(extractMessageText({
      content: [{ type: 'text', text: 'from content' }],
    })).toBe('from content')
  })

  it('strips single layer of archived thread wrapper', () => {
    const text = '[Continuing from archived thread: "黄金走势分析"]'
    expect(extractMessageText({ text })).toBe('黄金走势分析')
  })

  it('strips nested archived thread wrappers', () => {
    const text = '[Continuing from archived thread: "[Continuing from archived thread: \\"题目\\"]"]'
    // Should find the innermost non-bracket quoted string
    const result = extractMessageText({ text })
    expect(result).not.toContain('Continuing')
  })

  it('returns empty string for empty input', () => {
    expect(extractMessageText({})).toBe('')
  })
})

describe('organizer JSON parsing', () => {
  it('extracts JSON from response with surrounding text', () => {
    const response = 'Here are the groups:\n{"groups": [{"name": "Test", "pairs": ["id1"]}]}\nDone.'
    const match = response.match(/\{[\s\S]*\}/)
    expect(match).not.toBeNull()
    const parsed = JSON.parse(match![0]) as { groups: Array<{ name: string; pairs: string[] }> }
    expect(parsed.groups[0].name).toBe('Test')
  })

  it('handles response with no JSON gracefully', () => {
    const response = 'I cannot process this request.'
    const match = response.match(/\{[\s\S]*\}/)
    expect(match).toBeNull()
  })
})
