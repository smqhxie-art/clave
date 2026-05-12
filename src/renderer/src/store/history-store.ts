import { create } from 'zustand'
import { useSessionStore } from './session-store'

let latestHistorySearchRequest = 0
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const SEARCH_DEBOUNCE_MS = 200

export type HistoryRoleFilter = 'all' | 'user' | 'assistant'

export interface HistoryIndexProgress {
  processed: number
  total: number
  currentFile: string | null
  phase: 'scanning' | 'indexing' | 'done'
}

export interface HistoryProject {
  id: string
  name: string
  cwd: string
  storagePath: string
  encodedName: string
  sessionCount: number
  lastModified: string
}

export interface HistorySession {
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

export interface HistoryMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
  content: string
  timestamp: string
}

export interface HistorySearchResult {
  id: string
  projectId: string
  projectName: string
  sessionId: string
  sessionTitle: string
  sourcePath: string
  messageId: string
  role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
  preview: string
  content: string
  timestamp: string
}

interface HistoryState {
  projects: HistoryProject[]
  sessionsByProject: Record<string, HistorySession[]>
  selectedProjectId: string | null
  selectedSessionId: string | null
  selectedSession: HistorySession | null
  messages: HistoryMessage[]
  isLoadingProjects: boolean
  isLoadingMessages: boolean
  isSearching: boolean
  searchQuery: string
  searchRoleFilter: HistoryRoleFilter
  searchResults: HistorySearchResult[]
  targetMessageId: string | null
  isIndexing: boolean
  indexProgress: HistoryIndexProgress | null
  refresh: () => Promise<void>
  loadProjectSessions: (projectId: string) => Promise<HistorySession[]>
  selectSession: (session: HistorySession, options?: { targetMessageId?: string | null; skipViewSwitch?: boolean }) => Promise<void>
  setSearchQuery: (query: string) => void
  setSearchRoleFilter: (roleFilter: HistoryRoleFilter) => void
  searchMessages: (query: string, roleFilter?: HistoryRoleFilter) => Promise<void>
  openSearchResult: (result: HistorySearchResult) => Promise<void>
  clearSearch: () => void
  clearTargetMessage: () => void
  clearSelectedSession: () => void
  ensureHistoryIndex: () => Promise<void>
  setIndexProgress: (progress: HistoryIndexProgress | null) => void
}

function findSessionBySourcePath(
  sessionsByProject: Record<string, HistorySession[]>,
  sourcePath: string
): HistorySession | null {
  for (const sessions of Object.values(sessionsByProject)) {
    const session = sessions.find((item) => item.sourcePath === sourcePath)
    if (session) return session
  }
  return null
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  projects: [],
  sessionsByProject: {},
  selectedProjectId: null,
  selectedSessionId: null,
  selectedSession: null,
  messages: [],
  isLoadingProjects: false,
  isLoadingMessages: false,
  isSearching: false,
  searchQuery: '',
  searchRoleFilter: 'all',
  searchResults: [],
  targetMessageId: null,
  isIndexing: false,
  indexProgress: null,

  refresh: async () => {
    set({ isLoadingProjects: true })
    try {
      const projects = await window.electronAPI.historyListProjects()
      const loaded = await Promise.all(
        projects.map(async (project) => ({
          projectId: project.id,
          sessions: await window.electronAPI.historyLoadSessions(project.id)
        }))
      )

      const sessionsByProject = Object.fromEntries(
        loaded.map(({ projectId, sessions }) => [projectId, sessions])
      )

      const currentSelectedId = get().selectedSessionId
      const selectedSession = currentSelectedId
        ? findSessionBySourcePath(sessionsByProject, currentSelectedId)
        : null

      set({
        projects,
        sessionsByProject,
        selectedProjectId: selectedSession?.projectId ?? projects[0]?.id ?? null,
        selectedSessionId: selectedSession?.sourcePath ?? null,
        selectedSession: selectedSession ?? null
      })

      if (selectedSession) {
        await get().selectSession(selectedSession, { targetMessageId: get().targetMessageId, skipViewSwitch: true })
      } else {
        set({ messages: [] })
      }
    } finally {
      set({ isLoadingProjects: false })
    }
  },

  loadProjectSessions: async (projectId: string) => {
    const existing = get().sessionsByProject[projectId]
    if (existing) return existing

    const sessions = await window.electronAPI.historyLoadSessions(projectId)
    set((state) => ({
      sessionsByProject: {
        ...state.sessionsByProject,
        [projectId]: sessions
      }
    }))
    return sessions
  },

  selectSession: async (session, options) => {
    set({
      selectedProjectId: session.projectId,
      selectedSessionId: session.sourcePath,
      selectedSession: session,
      isLoadingMessages: true,
      targetMessageId: options?.targetMessageId ?? null
    })
    if (!options?.skipViewSwitch) {
      useSessionStore.getState().setActiveView('history')
    }

    try {
      const messages = await window.electronAPI.historyLoadMessages(session.sourcePath)
      set({
        messages,
        isLoadingMessages: false
      })
    } catch (error) {
      console.error('Failed to load Claude history messages:', error)
      set({
        messages: [],
        isLoadingMessages: false
      })
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSearchRoleFilter: (searchRoleFilter) => set({ searchRoleFilter }),

  searchMessages: async (query, roleFilter) => {
    const nextRoleFilter = roleFilter ?? get().searchRoleFilter
    const trimmed = query.trim()
    set({
      searchQuery: query,
      searchRoleFilter: nextRoleFilter
    })

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }

    if (!trimmed) {
      latestHistorySearchRequest += 1
      set({ isSearching: false, searchResults: [] })
      return
    }

    // Show the spinner right away so the UI doesn't feel dead during the debounce window.
    set({ isSearching: true })

    return new Promise<void>((resolve) => {
      searchDebounceTimer = setTimeout(async () => {
        searchDebounceTimer = null
        const requestId = ++latestHistorySearchRequest
        try {
          // Make sure the index is ready before searching; ensureHistoryIndex is a no-op
          // once the index is warm, so this is cheap on every call after the first.
          await window.electronAPI.historyEnsureIndex()
          if (requestId !== latestHistorySearchRequest) {
            resolve()
            return
          }
          const searchResults = await window.electronAPI.historySearch(trimmed, nextRoleFilter)
          if (requestId !== latestHistorySearchRequest) {
            resolve()
            return
          }
          set({ searchResults, isSearching: false })
        } catch (error) {
          console.error('Failed to search Claude history:', error)
          if (requestId === latestHistorySearchRequest) {
            set({ searchResults: [], isSearching: false })
          }
        } finally {
          resolve()
        }
      }, SEARCH_DEBOUNCE_MS)
    })
  },

  ensureHistoryIndex: async () => {
    try {
      await window.electronAPI.historyEnsureIndex()
    } catch (error) {
      console.error('Failed to ensure Claude history index:', error)
    }
  },

  setIndexProgress: (progress) => {
    if (progress === null) {
      set({ indexProgress: null, isIndexing: false })
      return
    }
    set({
      indexProgress: progress,
      isIndexing: progress.phase !== 'done'
    })
  },

  openSearchResult: async (result) => {
    let session = findSessionBySourcePath(get().sessionsByProject, result.sourcePath)
    if (!session) {
      const sessions = await get().loadProjectSessions(result.projectId)
      session = sessions.find((item) => item.sourcePath === result.sourcePath) ?? null
    }

    if (!session) return
    await get().selectSession(session, { targetMessageId: result.messageId })
  },

  clearSearch: () => {
    latestHistorySearchRequest += 1
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
    set({
      searchQuery: '',
      searchResults: [],
      isSearching: false
    })
  },

  clearTargetMessage: () => set({ targetMessageId: null }),

  clearSelectedSession: () =>
    set({
      selectedProjectId: null,
      selectedSessionId: null,
      selectedSession: null,
      messages: []
    })
}))

// Subscribe once to index progress events from the main process.
if (typeof window !== 'undefined' && window.electronAPI?.onHistoryIndexProgress) {
  window.electronAPI.onHistoryIndexProgress((progress) => {
    useHistoryStore.getState().setIndexProgress(progress.phase === 'done' ? null : progress)
  })
}
