import * as fs from 'fs'
import { homedir } from 'os'
import path from 'path'
import * as readline from 'readline'

export type ClaudeHistoryRole = 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
export type ClaudeHistoryRoleFilter = 'all' | 'user' | 'assistant'

export interface ClaudeHistoryProject {
  id: string
  name: string
  cwd: string
  storagePath: string
  encodedName: string
  sessionCount: number
  lastModified: string
}

export interface ClaudeHistorySession {
  id: string
  projectId: string
  projectName: string
  sessionId: string
  sourcePath: string
  cwd: string
  title: string
  summary: string
  createdAt: string
  lastModified: string
  messageCount: number
}

export interface ClaudeHistoryMessage {
  id: string
  sessionId: string
  role: ClaudeHistoryRole
  content: string
  timestamp: string
}

export interface ClaudeHistorySearchResult {
  id: string
  projectId: string
  projectName: string
  sessionId: string
  sessionTitle: string
  sourcePath: string
  messageId: string
  role: ClaudeHistoryRole
  preview: string
  content: string
  timestamp: string
}

interface ParsedJsonLine {
  uuid?: string
  sessionId?: string
  timestamp?: string
  cwd?: string
  type?: string
  isMeta?: boolean
  summary?: string
  customTitle?: string
  lastPrompt?: string
  message?: {
    role?: string
    content?: unknown
  }
}

export const CLAUDE_PROJECTS_ROOT = path.join(homedir(), '.claude', 'projects')
const MAX_LINE_BYTES = 512 * 1024

function normalizeIsoDate(value: string | undefined | null): string {
  if (!value) return new Date(0).toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

function parseJsonLine(line: string): ParsedJsonLine | null {
  if (!line.trim()) return null
  try {
    return JSON.parse(line) as ParsedJsonLine
  } catch {
    return null
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const block = item as Record<string, unknown>
    const blockType = typeof block.type === 'string' ? block.type : null

    if (typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }

    if (typeof block.content === 'string') {
      parts.push(block.content)
      continue
    }

    if (typeof block.thinking === 'string') {
      parts.push(block.thinking)
      continue
    }

    if (blockType === 'tool_use' && typeof block.name === 'string') {
      parts.push(block.name)
      continue
    }

    if (blockType === 'tool_result') {
      if (typeof block.content === 'string') {
        parts.push(block.content)
      } else if (Array.isArray(block.content)) {
        parts.push(extractTextFromContent(block.content))
      }
    }
  }

  return parts.join('\n').trim()
}

function resolveMessageRole(entry: ParsedJsonLine): ClaudeHistoryRole {
  const role = entry.message?.role
  if (role === 'user') {
    const content = entry.message?.content
    if (
      Array.isArray(content) &&
      content.length > 0 &&
      content.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).type === 'tool_result'
      )
    ) {
      return 'tool'
    }
  }

  if (role === 'user' || role === 'assistant' || role === 'system') return role
  if (entry.type === 'user' || entry.type === 'assistant') return entry.type
  return 'unknown'
}

export async function listClaudeHistoryProjects(): Promise<ClaudeHistoryProject[]> {
  const { listProjectsFromIndex } = await import('./claude-history-index')
  return listProjectsFromIndex()
}

export async function loadClaudeHistorySessions(
  projectId: string
): Promise<ClaudeHistorySession[]> {
  const { listSessionsFromIndex } = await import('./claude-history-index')
  return listSessionsFromIndex(projectId)
}

/**
 * Reads a single session file line-by-line and returns all messages (user/assistant/tool/system).
 * Used by the detail view, which wants the full transcript including tool interactions.
 *
 * Streaming + per-line size cap keeps this safe on pathological files where one line
 * can be 10+ MB of tool output; such lines are skipped rather than loaded.
 */
export async function loadClaudeHistoryMessages(
  sourcePath: string
): Promise<ClaudeHistoryMessage[]> {
  const messages: ClaudeHistoryMessage[] = []
  const stream = fs.createReadStream(sourcePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  let index = 0
  try {
    for await (const rawLine of rl) {
      index += 1
      if (!rawLine || !rawLine.trim()) continue
      if (rawLine.length > MAX_LINE_BYTES) continue

      const entry = parseJsonLine(rawLine)
      if (!entry || entry.isMeta) continue

      const role = resolveMessageRole(entry)
      if (role === 'unknown') continue

      const content = extractTextFromContent(entry.message?.content)
      if (!content) continue

      messages.push({
        id: entry.uuid || `${path.basename(sourcePath)}:${index}`,
        sessionId: entry.sessionId || path.basename(sourcePath, '.jsonl'),
        role,
        content,
        timestamp: normalizeIsoDate(entry.timestamp)
      })
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return messages
}

export async function searchClaudeHistoryMessages(
  query: string,
  roleFilter: ClaudeHistoryRoleFilter = 'all'
): Promise<ClaudeHistorySearchResult[]> {
  const { searchClaudeHistoryIndex } = await import('./claude-history-index')
  return searchClaudeHistoryIndex(query, roleFilter)
}
