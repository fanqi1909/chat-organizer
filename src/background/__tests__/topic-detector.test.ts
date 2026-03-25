import { describe, it, expect } from 'vitest'
import { tokenize, heuristicDetect } from '../topic-detector'
import type { Message } from '../../shared/types'

const msg = (role: 'human' | 'assistant', text: string): Message => ({
  id: Math.random().toString(),
  role,
  text,
  timestamp: Date.now(),
})

describe('tokenize', () => {
  it('extracts Latin words longer than 2 chars', () => {
    expect(tokenize('hello world hi')).toEqual(['hello', 'world'])
  })

  it('lowercases tokens', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world'])
  })

  it('extracts CJK single chars and bigrams', () => {
    const tokens = tokenize('黄金价格')
    expect(tokens).toContain('黄')
    expect(tokens).toContain('黄金')
    expect(tokens).toContain('金')
    expect(tokens).toContain('金价')
  })

  it('handles mixed Latin and CJK', () => {
    const tokens = tokenize('Claude API使用')
    expect(tokens).toContain('claude')
    expect(tokens).toContain('使')
    expect(tokens).toContain('使用')
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('heuristicDetect', () => {
  it('returns no new thread for first message', () => {
    const result = heuristicDetect(msg('assistant', 'hi'), [msg('human', 'hello')])
    expect(result.newThread).toBe(false)
  })

  it('detects explicit transition phrase "btw"', () => {
    const history = [
      msg('human', 'tell me about gold'),
      msg('assistant', 'gold is valuable'),
      msg('human', 'interesting'),
      msg('assistant', 'yes'),
      msg('human', 'btw, what is the weather today'),
    ]
    const result = heuristicDetect(msg('assistant', 'sunny'), history)
    expect(result.newThread).toBe(true)
  })

  it('detects Chinese transition phrase 换个话题', () => {
    const history = [
      msg('human', '黄金走势如何'),
      msg('assistant', '黄金最近上涨'),
      msg('human', '好的'),
      msg('assistant', '是的'),
      msg('human', '换个话题，今天天气怎么样'),
    ]
    const result = heuristicDetect(msg('assistant', '天气晴朗'), history)
    expect(result.newThread).toBe(true)
  })

  it('does not flag continuation of same topic as new thread', () => {
    // Use identical tokens — heuristic does not stem (price ≠ prices)
    const history = [
      msg('human', 'tell me about gold prices'),
      msg('assistant', 'gold prices have been rising'),
      msg('human', 'why are gold prices going up'),
      msg('assistant', 'gold prices rise due to inflation'),
      msg('human', 'what are gold prices historically'),
    ]
    const result = heuristicDetect(msg('assistant', 'historically gold prices...'), history)
    expect(result.newThread).toBe(false)
  })
})
