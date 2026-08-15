import type { Progress, ReaderSettings, ReaderTheme, ReadingState } from '../types'

const KEY = 'xiaoshuotiantuan:reading:v2'

export const defaultReadingState: ReadingState = {
  progress: {},
  settings: { fontSize: 18, lineHeight: 1.9, theme: 'sepia' },
}

const THEMES: ReaderTheme[] = ['day', 'sepia', 'night']

/**
 * localStorage 里的东西不是我们写进去的就一定还是原样——旧版本留下的、手改过的、
 * 半截写坏的都可能在。原先只做了 JSON.parse 的 try/catch，形状一概照单全收：
 * settings 里塞个字符串字号，就会直接流进 `fontSize: ${x}px` 变成一条无效样式。
 */
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

/** 上下界跟阅读器里那两个步进器一致，手改出界的值会被拉回可用范围 */
function parseSettings(raw: unknown): ReaderSettings {
  const fallback = defaultReadingState.settings
  if (typeof raw !== 'object' || raw === null) return fallback
  const s = raw as Record<string, unknown>
  return {
    fontSize: clamp(s.fontSize, 14, 28, fallback.fontSize),
    lineHeight: clamp(s.lineHeight, 1.5, 2.6, fallback.lineHeight),
    theme: THEMES.includes(s.theme as ReaderTheme) ? (s.theme as ReaderTheme) : fallback.theme,
  }
}

function parseProgress(raw: unknown): Record<string, Progress> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, Progress> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const p = value as Record<string, unknown>
    if (typeof p.chapterId !== 'string' || !p.chapterId) continue
    out[id] = {
      chapterId: p.chapterId,
      ratio: clamp(p.ratio, 0, 1, 0),
      // at 缺了会让书架上「最近在读」那三条按 NaN 排序，补 0 让它沉底而不是把顺序搅乱
      at: clamp(p.at, 0, Number.MAX_SAFE_INTEGER, 0),
    }
  }
  return out
}

export function loadReadingState(): ReadingState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultReadingState
    const parsed: unknown = JSON.parse(raw)
    const root = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
    return { progress: parseProgress(root.progress), settings: parseSettings(root.settings) }
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
