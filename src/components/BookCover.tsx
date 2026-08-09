import type { CSSProperties } from 'react'
import type { Novel } from '../types'

type Props = {
  novel: Novel
  size?: 'sm' | 'md' | 'lg'
}

export function BookCover({ novel, size = 'md' }: Props) {
  // 样式表只负责版式，配色按每本书的 hue 现算，保证同一书架上颜色不重样
  const style: CSSProperties = {
    background: `linear-gradient(155deg, hsl(${novel.hue} 46% 47%), hsl(${
      (novel.hue + 28) % 360
    } 52% 26%))`,
  }

  return (
    <div className={`cover cover-${size}`} style={style} aria-hidden="true">
      <span className="cover-spine" />
      <span className="cover-title">{novel.title}</span>
      <span className="cover-author">{novel.author}</span>
    </div>
  )
}
