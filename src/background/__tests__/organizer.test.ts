import { describe, it, expect } from 'vitest'
import { buildGroups, jaccardSimilarity, mergeByNameSimilarity } from '../organizer'
import type { TopicGroup } from '../../shared/types'

const pair = (pairId: string, convId = 'conv1', question = 'q') => ({
  pairId,
  convId,
  convTitle: convId,
  question,
  answer: 'a',
  pairIndex: 0,
})

describe('buildGroups', () => {
  it('groups pairs by label', () => {
    const labels = { p1: '黄金走势', p2: '黄金走势', p3: '学校假期' }
    const pairs = [pair('p1'), pair('p2'), pair('p3')]
    const groups = buildGroups(labels, pairs)
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.name === '黄金走势')?.pairs).toHaveLength(2)
    expect(groups.find((g) => g.name === '学校假期')?.pairs).toHaveLength(1)
  })

  it('each pair appears in exactly one group', () => {
    const labels = { p1: 'A', p2: 'B', p3: 'A' }
    const pairs = [pair('p1'), pair('p2'), pair('p3')]
    const groups = buildGroups(labels, pairs)
    const allPairs = groups.flatMap((g) => g.pairs)
    expect(allPairs).toHaveLength(3)
  })

  it('skips pairs with no label', () => {
    const labels = { p1: '黄金' }
    const pairs = [pair('p1'), pair('p2')]
    const groups = buildGroups(labels, pairs)
    expect(groups.flatMap((g) => g.pairs)).toHaveLength(1)
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(jaccardSimilarity('黄金走势', '黄金走势')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(jaccardSimilarity('黄金走势', '学校假期')).toBe(0)
  })

  it('returns high similarity for overlapping Chinese text', () => {
    const sim = jaccardSimilarity('黄金走势', '黄金价格')
    expect(sim).toBeGreaterThan(0.2)
  })

  it('returns high similarity for overlapping English text', () => {
    const sim = jaccardSimilarity('gold price trend', 'gold price history')
    expect(sim).toBeGreaterThan(0.4)
  })

  it('handles empty strings', () => {
    expect(jaccardSimilarity('', '')).toBe(1)
    expect(jaccardSimilarity('hello', '')).toBe(0)
  })
})

describe('mergeByNameSimilarity', () => {
  it('merges groups with similar names', () => {
    const groups: TopicGroup[] = [
      { name: 'gold price trend', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q1', pairIndex: 0 }] },
      { name: 'gold price history', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q2', pairIndex: 1 }] },
    ]
    const merged = mergeByNameSimilarity(groups, 0.4)
    expect(merged).toHaveLength(1)
    expect(merged[0].pairs).toHaveLength(2)
  })

  it('keeps groups with different names separate', () => {
    const groups: TopicGroup[] = [
      { name: '黄金走势', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q1', pairIndex: 0 }] },
      { name: '学校假期', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q2', pairIndex: 1 }] },
    ]
    const merged = mergeByNameSimilarity(groups, 0.4)
    expect(merged).toHaveLength(2)
  })

  it('merges chain: A~B and B~C into one group', () => {
    const groups: TopicGroup[] = [
      { name: 'gold price trend', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q1', pairIndex: 0 }] },
      { name: 'gold price history', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q2', pairIndex: 1 }] },
      { name: 'gold price analysis', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q3', pairIndex: 2 }] },
    ]
    const merged = mergeByNameSimilarity(groups, 0.4)
    expect(merged).toHaveLength(1)
    expect(merged[0].pairs).toHaveLength(3)
  })

  it('preserves total pair count after merging', () => {
    const groups: TopicGroup[] = [
      { name: 'gold trend', pairs: [{ convId: 'c1', convTitle: 'c1', question: 'q1', pairIndex: 0 }] },
      { name: 'gold history', pairs: [{ convId: 'c2', convTitle: 'c2', question: 'q2', pairIndex: 0 }] },
      { name: 'school holiday', pairs: [{ convId: 'c3', convTitle: 'c3', question: 'q3', pairIndex: 0 }] },
    ]
    const merged = mergeByNameSimilarity(groups, 0.3)
    const total = merged.reduce((sum, g) => sum + g.pairs.length, 0)
    expect(total).toBe(3)
  })
})

describe('extractMessageText', () => {
  function extractMessageText(m: { text?: string; content?: Array<{ type: string; text: string }> }): string {
    let text = m.text ?? m.content?.find((c) => c.type === 'text')?.text ?? ''
    if (text.includes('Continuing from archived thread')) {
      const inner = text.match(/"([^"\[\]]{3,})"/)
      text = inner ? inner[1] : ''
    }
    return text.trim()
  }

  it('returns plain text', () => {
    expect(extractMessageText({ text: 'hello' })).toBe('hello')
  })

  it('strips archived thread wrapper', () => {
    expect(extractMessageText({ text: '[Continuing from archived thread: "黄金走势分析"]' }))
      .toBe('黄金走势分析')
  })
})
