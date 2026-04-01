import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../files/MarkdownRenderer'
import { cn } from '../../lib/utils'
import type { ChatMessage as ChatMessageType } from '../../../../shared/remote-types'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-text-tertiary bg-surface-100 rounded-full px-3 py-1">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex gap-3 py-2', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-surface-100 text-text-primary rounded-bl-md'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose-sm">
            <MarkdownRenderer content={message.content} />
          </div>
        )}
        {message.status === 'streaming' && (
          <span className="inline-block w-1.5 h-4 bg-current opacity-60 animate-pulse ml-0.5 align-text-bottom" />
        )}
        {message.status === 'error' && (
          <span className="text-xs text-red-400 mt-1 block">{t('agent.chat.message.error.sendFailed')}</span>
        )}
      </div>
    </div>
  )
}
