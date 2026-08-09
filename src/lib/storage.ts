import type { ReadingState } from '../types'

const KEY = 'xiaoshuotiantuan:reading:v2'

export const defaultReadingState: ReadingState = {
  progress: {},
  settings: { fontSize: 18, lineHeight: 1.9, theme: 'sepia' },
}

export function loadReadingState(): ReadingState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultReadingState
    const parsed = JSON.parse(raw) as Partial<ReadingState>
    return {
      progress: parsed.progress ?? {},
      settings: { ...defaultReadingState.settings, ...parsed.settings },
    }
  } catch {
    return defaultReadingState
  }
}

export function saveReadingState(state: ReadingState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 隐私模式或配额用尽时静默降级为纯内存状态
  }
}
