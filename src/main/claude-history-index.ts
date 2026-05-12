import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import { promises as fsp } from 'fs'
import { homedir } from 'os'
import path from 'path'
import * as readline from 'readline'
import fg from 'fast-glob'

import {
  CLAUDE_PROJECTS_ROOT,
  type ClaudeHistoryProject,
  type ClaudeHistoryRole,
  type ClaudeHistoryRoleFilter,
  type ClaudeHistorySearchResult,
  type ClaudeHistorySession
} from './claude-history'

// --- Config ---

export const INDEX_PATH = path.join(homedir(), '.claude', 'clave-history-index.json')
const INDEX_VERSION = 1
const MAX_LINE_BYTES = 512 * 1024 // 512 KB per line hard cap (larger is tool_result)
const TOOL_SNIFF_BYTES = 512 // bytes to look at for cheap tool-result detection
const INDEX_CONCURRENCY = 8
const SEARCH_RESULT_LIMIT = 50
const PROGRESS_CHANNEL = 'claude-history:index-progress'
const PROGRESS_EMIT_MIN_INTERVAL_MS = 50

// --- Types ---

interface IndexedMessage {
  messageId: string
  role: 'user' | 'assistant'
  timestampMs: number
  text: string // already normalized (markdown stripped, whitespace collapsed)
}

interface FileIndex {
  path: string
  mtimeMs: number
  size: number
  projectDir: string // absolute project storage dir
  sessionId: string
  cwd: string
  title: string
  summary: string
  createdAtMs: number
  lastModifiedMs: number
  messageCount: number // total user+assistant messages kept
  messages: IndexedMessage[]
}

interface HistoryIndex {
  version: number
  files: Record<string, FileIndex>
}

export interface IndexProgress {
  processed: number
  total: number
  currentFile: string | null
  phase: 'scanning' | 'indexing' | 'done'
}

// --- Text helpers (minimal duplicates of claude-history.ts pure helpers) ---
// Intentionally duplicated to avoid a circular dep with claude-history.ts
// and to keep the indexer self-contained. These must stay in sync.

function stripMarkdownForSearchDisplay(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}([^`]+?)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
}

function normalizeSearchableText(value: string): string {
  return stripMarkdownForSearchDisplay(value).replace(/\s+/g, ' ').trim()
}

function normalizeDisplayText(value: string, maxLength = 240): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1).trimEnd()}…` : compact
}

function isLikelyClaudeCommand(text: string): boolean {
  return (
    text.startsWith('<command-name>/') ||
    text.startsWith('<local-command-stdout>') ||
    text.startsWith('<local-command-stderr>') ||
    text.startsWith('<local-command-caveat>') ||
    text.startsWith('<command-message>') ||
    text.startsWith('<task-notification>')
  )
}

function isLikelyToolResultNoise(text: string): boolean {
  return (
    text.startsWith('File created successfully at:') ||
    text.startsWith('The file ') ||
    text.startsWith('User has answered your questions:') ||
    text.startsWith('User has approved your plan.') ||
    text.startsWith('Entered plan mode.') ||
    text.startsWith('Web search results for query:') ||
    text.startsWith('(Bash completed') ||
    text.startsWith('Exit code ') ||
    text.startsWith('To suppress this warning,') ||
    text === '405'
  )
}

function isMeaningfulPromptCandidate(text: string): boolean {
  if (!text) return false
  if (isLikelyClaudeCommand(text)) return false
  if (isLikelyToolResultNoise(text)) return false
  return true
}

function buildPreview(content: string, query: string): string {
  const trimmed = normalizeSearchableText(content)
  if (!trimmed) return ''

  const lowerContent = trimmed.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerContent.indexOf(lowerQuery)
  if (matchIndex === -1) return trimmed.slice(0, 180)

  const start = Math.max(0, matchIndex - 60)
  const end = Math.min(trimmed.length, matchIndex + query.length + 60)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < trimmed.length ? '...' : ''
  return `${prefix}${trimmed.slice(start, end)}${suffix}`
}

// --- JSONL parsing types ---

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

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const block = item as Record<string, unknown>
    const blockType = typeof block.type === 'string' ? block.type : null

    // We skip tool-result blocks entirely in the indexer (search is user+assistant only).
    if (blockType === 'tool_result' || blockType === 'tool_use') continue

    if (typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }

    if (typeof block.thinking === 'string') {
      parts.push(block.thinking)
      continue
    }
  }

  return parts.join('\n').trim()
}

/**
 * Cheap byte-level sniff to reject tool-result lines BEFORE JSON.parse.
 * Returns true if the line looks like a tool_result message (should skip).
 */
function sniffIsToolResultLine(line: string): boolean {
  const head = line.length > TOOL_SNIFF_BYTES ? line.slice(0, TOOL_SNIFF_BYTES) : line
  // user messages that carry tool_result blocks always have "tool_use_id" near the top,
  // and tool_result type marker. Either is sufficient.
  return head.includes('"tool_use_id"') || head.includes('"tool_result"')
}

/** Quick header check: must carry type:"user" or type:"assistant" to be worth indexing. */
function sniffIsIndexable(line: string): boolean {
  const head = line.length > TOOL_SNIFF_BYTES ? line.slice(0, TOOL_SNIFF_BYTES) : line
  return (
    head.includes('"type":"user"') ||
    head.includes('"type":"assistant"') ||
    // Meta rows we still want to keep for title/summary/custom-title/last-prompt
    head.includes('"type":"summary"') ||
    head.includes('"type":"custom-title"') ||
    head.includes('"type":"last-prompt"')
  )
}

function resolveIndexedRole(entry: ParsedJsonLine): 'user' | 'assistant' | null {
  const role = entry.message?.role
  if (role === 'assistant' || entry.type === 'assistant') return 'assistant'
  if (role !== 'user' && entry.type !== 'user') return null

  // Exclude user messages that are purely tool results.
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
    return null
  }
  return 'user'
}

// --- Per-file indexer (streaming) ---

interface ParsedFileResult {
  fileIndex: FileIndex
  skippedBigLines: number
}

async function parseFile(
  filePath: string,
  stat: fs.Stats,
  projectDir: string
): Promise<ParsedFileResult> {
  const messages: IndexedMessage[] = []

  let actualSessionId = path.basename(filePath, '.jsonl')
  let cwd = ''
  let createdAtMs = 0
  let lastModifiedMs = 0
  let explicitSummary = ''
  let customTitle = ''
  let lastPrompt = ''
  let firstUserMessageText = ''
  let latestSnippet = ''
  let skippedBigLines = 0

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const rawLine of rl) {
      const line = rawLine
      if (!line || !line.trim()) continue

      // Hard cap: huge lines are tool_result dumps. Skip entirely, never JSON.parse.
      if (line.length > MAX_LINE_BYTES) {
        skippedBigLines += 1
        continue
      }

      if (!sniffIsIndexable(line)) continue

      // Byte-level pre-filter: user+tool_result → skip without parse.
      // Note: we only do this for lines that *look like* user rows to avoid false positives
      // on assistant rows that mention "tool_result" inside a thinking block.
      // In practice assistant rows never carry tool_result blocks in this JSONL format.
      if (sniffIsToolResultLine(line)) continue

      let entry: ParsedJsonLine
      try {
        entry = JSON.parse(line) as ParsedJsonLine
      } catch {
        continue
      }

      if (entry.isMeta) continue

      // Pick up per-file metadata opportunistically.
      if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd
      if (entry.timestamp) {
        const t = Date.parse(entry.timestamp)
        if (!Number.isNaN(t)) {
          if (!createdAtMs) createdAtMs = t
          lastModifiedMs = t
        }
      }
      if (entry.sessionId) actualSessionId = entry.sessionId

      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
        const n = normalizeDisplayText(entry.customTitle)
        if (n) customTitle = n
        continue
      }
      if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') {
        const n = normalizeDisplayText(entry.lastPrompt)
        if (n) lastPrompt = n
        continue
      }
      if (entry.type === 'summary' && typeof entry.summary === 'string' && !explicitSummary) {
        explicitSummary = normalizeDisplayText(entry.summary)
        continue
      }

      const role = resolveIndexedRole(entry)
      if (!role) continue

      const rawText = extractTextFromContent(entry.message?.content)
      if (!rawText) continue

      const text = normalizeSearchableText(rawText)
      if (!text) continue

      const display = normalizeDisplayText(rawText)
      if (display) latestSnippet = display
      if (!firstUserMessageText && role === 'user' && isMeaningfulPromptCandidate(display)) {
        firstUserMessageText = display
      }

      const tsMs = entry.timestamp ? Date.parse(entry.timestamp) : 0
      messages.push({
        messageId:
          entry.uuid || `${path.basename(filePath)}:${messages.length}`,
        role,
        timestampMs: Number.isFinite(tsMs) ? tsMs : 0,
        text
      })
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  if (!lastModifiedMs) lastModifiedMs = stat.mtimeMs
  if (!createdAtMs) createdAtMs = lastModifiedMs

  const title =
    customTitle ||
    lastPrompt ||
    explicitSummary ||
    firstUserMessageText ||
    path.basename(cwd || projectDir) ||
    actualSessionId.slice(0, 8)
  const summary = latestSnippet || firstUserMessageText || explicitSummary

  return {
    fileIndex: {
      path: filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      projectDir,
      sessionId: actualSessionId,
      cwd: cwd || projectDir,
      title,
      summary,
      createdAtMs,
      lastModifiedMs,
      messageCount: messages.length,
      messages
    },
    skippedBigLines
  }
}

// --- Concurrency limiter (local copy to avoid coupling to usage-manager) ---

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let idx = 0
  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// --- Persistence ---

function emptyIndex(): HistoryIndex {
  return { version: INDEX_VERSION, files: {} }
}

let inMemoryIndex: HistoryIndex | null = null
let loadedFromDisk = false

function loadIndexFromDisk(): HistoryIndex {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as HistoryIndex
    if (parsed && parsed.version === INDEX_VERSION && parsed.files) {
      return parsed
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[history-index] load failed, starting fresh:', (err as Error).message)
    }
  }
  return emptyIndex()
}

async function saveIndexToDisk(index: HistoryIndex): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(INDEX_PATH), { recursive: true })
    const tmp = `${INDEX_PATH}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(index), 'utf-8')
    await fsp.rename(tmp, INDEX_PATH)
  } catch (err) {
    console.warn('[history-index] save failed:', (err as Error).message)
  }
}

// --- Progress ---

let lastProgressEmitAt = 0
function emitProgress(progress: IndexProgress): void {
  const now = Date.now()
  if (progress.phase !== 'done' && now - lastProgressEmitAt < PROGRESS_EMIT_MIN_INTERVAL_MS) return
  lastProgressEmitAt = now
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(PROGRESS_CHANNEL, progress)
    } catch {
      // ignore dead renderers
    }
  }
}

// --- Index maintenance ---

let ensureInFlight: Promise<HistoryIndex> | null = null

async function listAllJsonl(): Promise<string[]> {
  try {
    return await fg('*/*.jsonl', {
      cwd: CLAUDE_PROJECTS_ROOT,
      absolute: true,
      onlyFiles: true,
      suppressErrors: true
    })
  } catch {
    return []
  }
}

/**
 * Returns the current HistoryIndex, building or updating it as needed.
 * Emits progress events while (re)indexing.
 *
 * - Loads the on-disk index once per process.
 * - Lists all jsonl files, stats them, removes entries for deleted files.
 * - Re-parses any file whose mtime or size changed.
 * - Writes the updated index to disk atomically.
 */
export async function ensureHistoryIndex(): Promise<HistoryIndex> {
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = (async () => {
    if (!loadedFromDisk) {
      inMemoryIndex = loadIndexFromDisk()
      loadedFromDisk = true
    }
    const index = inMemoryIndex ?? emptyIndex()

    emitProgress({ processed: 0, total: 0, currentFile: null, phase: 'scanning' })

    const files = await listAllJsonl()
    const fileSet = new Set(files)

    // Prune deleted files.
    for (const cached of Object.keys(index.files)) {
      if (!fileSet.has(cached)) delete index.files[cached]
    }

    // Determine which files need (re)indexing.
    const toProcess: { filePath: string; stat: fs.Stats; projectDir: string }[] = []
    for (const filePath of files) {
      let stat: fs.Stats
      try {
        stat = await fsp.stat(filePath)
      } catch {
        continue
      }
      const existing = index.files[filePath]
      if (!existing || existing.mtimeMs !== stat.mtimeMs || existing.size !== stat.size) {
        toProcess.push({ filePath, stat, projectDir: path.dirname(filePath) })
      }
    }

    const total = toProcess.length
    let processed = 0

    if (total === 0) {
      emitProgress({ processed: 0, total: 0, currentFile: null, phase: 'done' })
      inMemoryIndex = index
      return index
    }

    emitProgress({ processed: 0, total, currentFile: null, phase: 'indexing' })

    const tasks = toProcess.map((item) => async () => {
      try {
        const { fileIndex, skippedBigLines } = await parseFile(
          item.filePath,
          item.stat,
          item.projectDir
        )
        if (skippedBigLines > 0) {
          console.log(
            `[history-index] skipped ${skippedBigLines} huge line(s) in ${path.basename(
              item.filePath
            )}`
          )
        }
        index.files[item.filePath] = fileIndex
      } catch (err) {
        console.warn(
          `[history-index] failed to parse ${item.filePath}:`,
          (err as Error).message
        )
      } finally {
        processed += 1
        emitProgress({
          processed,
          total,
          currentFile: path.basename(item.filePath),
          phase: 'indexing'
        })
      }
    })

    await parallelLimit(tasks, INDEX_CONCURRENCY)

    inMemoryIndex = index
    await saveIndexToDisk(index)
    emitProgress({ processed, total, currentFile: null, phase: 'done' })
    return index
  })().finally(() => {
    ensureInFlight = null
  })
  return ensureInFlight
}

/**
 * Invalidates an in-memory cached file (e.g. when renderer requests a fresh load).
 * Does not delete the on-disk copy.
 */
export function invalidateHistoryIndexCache(): void {
  inMemoryIndex = null
  loadedFromDisk = false
}

// --- Public derivations (projects / sessions / search) ---

function toIsoFromMs(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return new Date(0).toISOString()
  return new Date(ms).toISOString()
}

function groupByProject(index: HistoryIndex): Map<string, FileIndex[]> {
  const byProject = new Map<string, FileIndex[]>()
  for (const file of Object.values(index.files)) {
    const existing = byProject.get(file.projectDir) ?? []
    existing.push(file)
    byProject.set(file.projectDir, existing)
  }
  return byProject
}

/** Helper for app code that wants to render project list from the index. */
export async function listProjectsFromIndex(): Promise<ClaudeHistoryProject[]> {
  const index = await ensureHistoryIndex()
  const byProject = groupByProject(index)
  const projects: ClaudeHistoryProject[] = []
  for (const [projectDir, files] of byProject) {
    const newest = files.reduce((max, f) => Math.max(max, f.lastModifiedMs), 0)
    const cwd = files.find((f) => f.cwd && path.isAbsolute(f.cwd))?.cwd || projectDir
    projects.push({
      id: projectDir,
      name: path.basename(cwd) || path.basename(projectDir),
      cwd,
      storagePath: projectDir,
      encodedName: path.basename(projectDir),
      sessionCount: files.length,
      lastModified: toIsoFromMs(newest)
    })
  }
  projects.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
  return projects
}

export async function listSessionsFromIndex(projectId: string): Promise<ClaudeHistorySession[]> {
  const index = await ensureHistoryIndex()
  const projectName = path.basename(
    Object.values(index.files).find((f) => f.projectDir === projectId)?.cwd || projectId
  )
  const sessions: ClaudeHistorySession[] = []
  for (const file of Object.values(index.files)) {
    if (file.projectDir !== projectId) continue
    sessions.push({
      id: file.path,
      projectId,
      projectName,
      sessionId: file.sessionId,
      sourcePath: file.path,
      cwd: file.cwd,
      title: file.title,
      summary: file.summary,
      createdAt: toIsoFromMs(file.createdAtMs),
      lastModified: toIsoFromMs(file.lastModifiedMs),
      messageCount: file.messageCount
    })
  }
  sessions.sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  )
  return sessions
}

function matchesRoleFilter(
  role: 'user' | 'assistant',
  filter: ClaudeHistoryRoleFilter
): boolean {
  if (filter === 'all') return true
  return role === filter
}

export async function searchClaudeHistoryIndex(
  query: string,
  roleFilter: ClaudeHistoryRoleFilter = 'all',
  limit = SEARCH_RESULT_LIMIT
): Promise<ClaudeHistorySearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const index = await ensureHistoryIndex()
  const q = trimmed.toLowerCase()
  const results: ClaudeHistorySearchResult[] = []

  // Iterate files from newest to oldest for better early-termination ergonomics.
  const files = Object.values(index.files).sort(
    (a, b) => b.lastModifiedMs - a.lastModifiedMs
  )

  outer: for (const file of files) {
    const projectName = path.basename(file.cwd || file.projectDir)
    for (const msg of file.messages) {
      if (!matchesRoleFilter(msg.role, roleFilter)) continue
      // text is already normalized and never huge; includes() is cheap.
      if (!msg.text.toLowerCase().includes(q)) continue

      const role: ClaudeHistoryRole = msg.role
      results.push({
        id: `${file.path}:${msg.messageId}`,
        projectId: file.projectDir,
        projectName,
        sessionId: file.sessionId,
        sessionTitle: file.title,
        sourcePath: file.path,
        messageId: msg.messageId,
        role,
        preview: buildPreview(msg.text, trimmed),
        // Keep `content` slim: we no longer ship the full body over IPC.
        // The field is kept in the type for compatibility but is set to the preview.
        content: '',
        timestamp: toIsoFromMs(msg.timestampMs)
      })

      if (results.length >= limit) break outer
    }
  }

  results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  return results
}

// --- Progress channel export for preload/IPC layers ---

export const HISTORY_INDEX_PROGRESS_CHANNEL = PROGRESS_CHANNEL

// --- Dev-only helpers, unused in prod ---

export function __getIndexPathForTest(): string {
  return INDEX_PATH
}
