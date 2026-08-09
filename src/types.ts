export type NovelStatus = 'draft' | 'ongoing' | 'finished'

export interface Chapter {
  id: string
  /** 正文/<dir>/ 下的文件名，重命名标题不会改动它，它只负责排序与定位 */
  file: string
  title: string
  content: string
  updatedAt: number
}

export interface Novel {
  id: string
  /** 正文/ 下的目录名 */
  dir: string
  title: string
  author: string
  intro: string
  tags: string[]
  status: NovelStatus
  /** 决定封面渐变色相，0-360 */
  hue: number
  chapters: Chapter[]
  updatedAt: number
}

export interface Progress {
  chapterId: string
  /** 章节内滚动百分比，0-1 */
  ratio: number
  at: number
}

export type ReaderTheme = 'day' | 'sepia' | 'night'

export interface ReaderSettings {
  fontSize: number
  lineHeight: number
  theme: ReaderTheme
}

/** 只有阅读侧状态存在浏览器里；正文本身以 正文/ 目录为唯一事实来源 */
export interface ReadingState {
  progress: Record<string, Progress>
  settings: ReaderSettings
}
