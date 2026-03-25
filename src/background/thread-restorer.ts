import type { Thread } from '../shared/types'
import { getOrgId, buildBaseUrl, createConversation, sendCompletion } from './platforms/claude-api'

/**
 * Create a real claude.ai conversation pre-loaded with thread history.
 * Returns the new conversation UUID so the tab can navigate directly to it.
 */
export async function restoreThread(thread: Thread): Promise<string> {
  const orgId = await getOrgId()
  const baseUrl = buildBaseUrl(orgId)

  const convUuid = await createConversation(baseUrl, thread.title)

  const historyText = thread.messages
    .map((m) => `${m.role === 'human' ? 'User' : 'Claude'}: ${m.text.slice(0, 500)}`)
    .join('\n\n')

  const prompt = `[Restoring saved thread: "${thread.title}"]\n\nHere is our previous conversation:\n\n${historyText}\n\n---\nThis context has been restored. Briefly acknowledge in one sentence that you remember this conversation, then wait for my next message.`

  await sendCompletion(baseUrl, convUuid, prompt, 150)

  return convUuid
}
