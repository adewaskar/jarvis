import type Anthropic from '@anthropic-ai/sdk'
import type { Message } from '../../../shared/agent'
export function toAnthropicMessages(messages: Message[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.map(message => ({
    role: message.role, content: message.content.map(part => {
      if (part.type === 'text')
        return { type: 'text' as const, text: part.text }
      if ('url' in part)
        return { type: 'image' as const, source: { type: 'url' as const, url: part.url } }
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(part.mimeType))
        throw new Error('Unsupported image MIME type')
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: part.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: part.data } }
    })
  }))
}
