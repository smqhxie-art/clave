import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowPathIcon, PlayIcon } from '@heroicons/react/24/outline'
import { cn } from '../../lib/utils'
import { MarkdownRenderer } from '../files/MarkdownRenderer'
import { useHistoryStore } from '../../store/history-store'
import { useSessionStore } from '../../store/session-store'
import {
  filterMetaSessions,
  getProjectDisplayName,
  getProjectColor,
  groupSessionsByDate
} from '../../lib/history-utils'

function highlightText(content: string, needle: string): ReactNode {
  if (!needle.trim()) return <>{content}</>

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'ig')
  const parts = content.split(regex)

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === needle.toLowerCase() ? (
          <mark key={`${part}-${index}`} className="bg-yellow-300/70 text-current rounded">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  )
}

/** A "turn" groups an assistant message with its subsequent tool results */
interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  messages: { id: string; role: string; content: string; timestamp: string }[]
  timestamp: string
}

function groupIntoTurns(messages: { id: string; role: string; content: string; timestamp: string }[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let current: ConversationTurn | null = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      // User messages are always their own turn
      if (current) turns.push(current)
      turns.push({
        id: msg.id,
        role: 'user',
        messages: [msg],
        timestamp: msg.timestamp
      })
      current = null
    } else if (msg.role === 'assistant') {
      // Start a new assistant turn
      if (current) turns.push(current)
      current = {
        id: msg.id,
        role: 'assistant',
        messages: [msg],
        timestamp: msg.timestamp
      }
    } else if (msg.role === 'tool') {
      // Attach tool results to current assistant turn
      if (current && current.role === 'assistant') {
        current.messages.push(msg)
      } else {
        // Orphaned tool message, show standalone
        if (current) turns.push(current)
        current = {
          id: msg.id,
          role: 'assistant',
          messages: [msg],
          timestamp: msg.timestamp
        }
      }
    } else {
      // system / unknown: skip
      if (current) turns.push(current)
      current = null
    }
  }
  if (current) turns.push(current)
  return turns
}

function ToolResultBlock({ content, searchQuery }: { content: string; searchQuery: string }) {
  const [expanded, setExpanded] = useState(false)
  const preview = content.length > 120 ? content.slice(0, 120).trimEnd() + '…' : content

  return (
    <div className="mt-2 rounded-lg bg-surface-200/40 border border-border-subtle px-2.5 py-1.5 text-xs text-text-secondary font-mono">
      <div className={cn('whitespace-pre-wrap break-words', !expanded && content.length > 120 && 'line-clamp-2')}>
        {searchQuery.trim() ? highlightText(expanded ? content : preview, searchQuery) : (expanded ? content : preview)}
      </div>
      {content.length > 120 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] font-medium text-text-tertiary hover:text-text-primary transition-colors"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      )}
    </div>
  )
}

export function HistoryPanel() {
  const selectedSession = useHistoryStore((s) => s.selectedSession)
  const messages = useHistoryStore((s) => s.messages)
  const isLoadingMessages = useHistoryStore((s) => s.isLoadingMessages)
  const targetMessageId = useHistoryStore((s) => s.targetMessageId)
  const clearTargetMessage = useHistoryStore((s) => s.clearTargetMessage)
  const refresh = useHistoryStore((s) => s.refresh)
  const searchQuery = useHistoryStore((s) => s.searchQuery)
  const sessionsByProject = useHistoryStore((s) => s.sessionsByProject)
  const isLoadingProjects = useHistoryStore((s) => s.isLoadingProjects)
  const projects = useHistoryStore((s) => s.projects)
  const selectSession = useHistoryStore((s) => s.selectSession)
  const addSession = useSessionStore((s) => s.addSession)
  const selectTerminalSession = useSessionStore((s) => s.selectSession)
  const setFocusedSession = useSessionStore((s) => s.setFocusedSession)
  const setActiveView = useSessionStore((s) => s.setActiveView)
  const setSidebarSearchQuery = useSessionStore((s) => s.setSearchQuery)

  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!targetMessageId) return
    const card = messageRefs.current[targetMessageId]
    if (!card) return

    // Prefer scrolling to the highlighted <mark> inside the card (for long messages),
    // fall back to the card itself if no highlight exists.
    const scrollTarget = card.querySelector('mark') ?? card

    let cancelled = false
    const scrollContainer = card.closest('.overflow-y-auto')

    const isInView = () => {
      if (!scrollContainer) return false
      const containerRect = scrollContainer.getBoundingClientRect()
      const rect = scrollTarget.getBoundingClientRect()
      return rect.top >= containerRect.top && rect.bottom <= containerRect.bottom
    }

    const attemptScroll = (remaining: number) => {
      if (cancelled) return
      scrollTarget.scrollIntoView({ behavior: 'instant', block: 'center' })
      if (remaining > 0 && !isInView()) {
        setTimeout(() => attemptScroll(remaining - 1), 100)
      }
    }

    requestAnimationFrame(() => attemptScroll(3))

    const timer = window.setTimeout(() => {
      clearTargetMessage()
    }, 1800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [targetMessageId, clearTargetMessage, messages])

  const restoreSession = async (dangerousMode: boolean = false) => {
    if (!selectedSession) return
    try {
      const sessionInfo = await window.electronAPI.spawnSession(selectedSession.cwd, {
        claudeMode: true,
        dangerousMode,
        resumeSessionId: selectedSession.sessionId
      })
      addSession({
        id: sessionInfo.id,
        cwd: sessionInfo.cwd,
        folderName: sessionInfo.folderName,
        name: selectedSession.title || sessionInfo.folderName,
        alive: sessionInfo.alive,
        activityStatus: 'idle',
        promptWaiting: null,
        claudeMode: true,
        dangerousMode,
        claudeSessionId: sessionInfo.claudeSessionId,
        sessionType: 'local'
      })
      setSidebarSearchQuery('')
      setFocusedSession(sessionInfo.id)
      selectTerminalSession(sessionInfo.id, false)
      setActiveView('terminals')
    } catch (error) {
      console.error('Failed to restore Claude session:', error)
    }
  }

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [messages]
  )

  const conversationTurns = useMemo(
    () => groupIntoTurns(sortedMessages),
    [sortedMessages]
  )

  const allSessions = useMemo(() => {
    const all = Object.values(sessionsByProject)
      .flat()
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
    return filterMetaSessions(all)
  }, [sessionsByProject])

  const groupedSessions = useMemo(() => groupSessionsByDate(allSessions), [allSessions])

  // Trigger load if we land here with no data yet (e.g. direct "History" click with no prior expand)
  useEffect(() => {
    if (!selectedSession && !isLoadingProjects && projects.length === 0) {
      refresh().catch(console.error)
    }
  }, [selectedSession, isLoadingProjects, projects.length, refresh])

  if (!selectedSession) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface-50">
        <div className="flex-1 overflow-auto">
          <div className="max-w-2xl mx-auto px-6 py-8">
            {/* Title */}
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-semibold text-text-primary">Chats</h1>
              <button
                type="button"
                onClick={() => refresh()}
                className="btn-icon btn-icon-md"
                title="Refresh"
              >
                <ArrowPathIcon className={`w-4 h-4 ${isLoadingProjects ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Session list */}
            {isLoadingProjects && allSessions.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm text-text-tertiary gap-2">
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Scanning history…
              </div>
            ) : allSessions.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm text-text-tertiary">
                No history found on this machine.
              </div>
            ) : (
              <div>
                {groupedSessions.map((group) => (
                  <div key={group.label} className="mb-1">
                    <div className="sticky top-0 z-10 py-2 bg-surface-50/95 backdrop-blur-sm">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                        {group.label}
                      </span>
                    </div>
                    <div>
                      {group.sessions.map((session) => {
                        const projectName = getProjectDisplayName(session.projectName)
                        const date = new Date(session.lastModified)
                        const isToday = date.toDateString() === new Date().toDateString()
                        const timeStr = isToday
                          ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                          : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
                        return (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => selectSession(session).catch(console.error)}
                            className="w-full flex items-center gap-4 px-3 py-3 -mx-3 rounded-lg text-left hover:bg-surface-100 transition-colors group"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-text-primary truncate">
                                {session.title}
                              </div>
                              <div className="flex items-center gap-0 text-xs text-text-tertiary mt-0.5">
                                <span className="truncate max-w-[65%]">
                                  {session.summary && session.summary !== session.title
                                    ? session.summary
                                    : `${session.messageCount} messages`}
                                </span>
                                <span className="mx-1.5 opacity-40 flex-shrink-0">·</span>
                                <span className="flex-shrink-0 whitespace-nowrap">{timeStr}</span>
                                <span className="mx-1.5 opacity-40 flex-shrink-0">·</span>
                                <span className="flex-shrink-0 whitespace-nowrap tabular-nums">{session.messageCount} msg</span>
                              </div>
                            </div>
                            <div className="flex-shrink-0">
                              <span
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded max-w-[120px] truncate block"
                                style={{
                                  color: getProjectColor(projectName),
                                  backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)'
                                }}
                              >
                                {projectName}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface-50">
      {/* Compact header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-surface-100/80 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-text-primary truncate">
            {selectedSession.title}
          </h2>
          <div className="flex items-center gap-0 text-xs text-text-tertiary mt-0.5">
            <span className="truncate">{selectedSession.cwd.replace(/^\/Users\/[^/]+/, '~')}</span>
            <span className="mx-1.5 opacity-40 flex-shrink-0">·</span>
            <span className="flex-shrink-0">{selectedSession.messageCount} messages</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => refresh()}
            className="btn-icon btn-icon-md"
            title="Refresh"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => restoreSession(true)}
            title="Resume (skip permissions)"
          >
            <PlayIcon className="w-3 h-3" />
            Resume
          </button>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 py-5 space-y-3">
          {isLoadingMessages ? (
            <div className="text-sm text-text-tertiary text-center py-8">Loading session messages...</div>
          ) : conversationTurns.length === 0 ? (
            <div className="text-sm text-text-tertiary text-center py-8">No visible messages in this session.</div>
          ) : (
            conversationTurns.map((turn) => {
              const isUser = turn.role === 'user'
              const mainMsg = turn.messages[0]
              const toolMessages = turn.messages.filter((m) => m.role === 'tool')
              const assistantMessages = turn.messages.filter((m) => m.role === 'assistant')
              const timeStr = new Date(turn.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

              return (
                <div
                  key={turn.id}
                  ref={(node) => {
                    // Register refs for all messages in the turn (for search scroll targeting)
                    for (const m of turn.messages) {
                      messageRefs.current[m.id] = node
                    }
                  }}
                  className={cn(
                    'flex flex-col',
                    isUser ? 'items-end' : 'items-start'
                  )}
                >
                  {/* Timestamp */}
                  <span className={cn(
                    'text-[10px] text-text-tertiary/60 mb-1 px-1',
                    isUser ? 'text-right' : 'text-left'
                  )}>
                    {timeStr}
                  </span>

                  {/* Bubble — same component for both sides */}
                  <div
                    className={cn(
                      'rounded-2xl border px-2.5 py-1.5 w-fit max-w-[85%]',
                      isUser
                        ? 'rounded-br-md bg-accent/10 border-accent/20'
                        : 'rounded-bl-md bg-surface-100 border-border-subtle',
                      turn.messages.some((m) => targetMessageId === m.id) && 'ring-2 ring-accent'
                    )}
                  >
                    {/* Text content — same render for both sides */}
                    {(isUser ? [mainMsg] : assistantMessages).map((msg, i) => {
                      const hasMarkdown = !searchQuery.trim() && msg.role === 'assistant' && /[*#`\[\]|>~]/.test(msg.content)
                      return (
                        <div key={msg.id}>
                          {i > 0 && <div className="my-1.5 border-t border-border-subtle" />}
                          {hasMarkdown ? (
                            <div className="text-[13px] leading-normal text-text-primary max-w-none [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_pre]:my-1.5 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5">
                              <MarkdownRenderer content={msg.content} />
                            </div>
                          ) : (
                            <div className="text-[13px] leading-normal text-text-primary whitespace-pre-wrap break-words">
                              {searchQuery.trim() ? highlightText(msg.content, searchQuery) : msg.content}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Tool results (only present in assistant turns) */}
                    {toolMessages.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="h-px flex-1 bg-border-subtle" />
                          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                            {toolMessages.length} tool {toolMessages.length === 1 ? 'result' : 'results'}
                          </span>
                          <div className="h-px flex-1 bg-border-subtle" />
                        </div>
                        {toolMessages.map((tm) => (
                          <ToolResultBlock key={tm.id} content={tm.content} searchQuery={searchQuery} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
