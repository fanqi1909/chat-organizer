/**
 * Extracts a conversation ID from a URL path like /chat/abc-123 or /c/abc-123
 */
export function extractConversationId(url: string): string | null {
  const match = url.match(/\/(?:chat|c)\/([a-f0-9-]+)/)
  return match ? match[1] : null
}

/**
 * Truncates a string to maxLen chars, appending ellipsis if truncated
 */
export function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…'
}
