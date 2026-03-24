import type { PlatformAdapter } from '../../shared/types'
import { claudeAdapter } from './claude'
import { chatgptAdapter } from './chatgpt'

const adapters: PlatformAdapter[] = [claudeAdapter, chatgptAdapter]

const hostToAdapter: Record<string, PlatformAdapter> = {
  'claude.ai': claudeAdapter,
  'chat.openai.com': chatgptAdapter,
}

export function getPlatformAdapter(): PlatformAdapter | null {
  const adapter = hostToAdapter[location.hostname]
  return adapter ?? null
}

export { adapters }
