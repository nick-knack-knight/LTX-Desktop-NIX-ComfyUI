import { useEffect, useRef, useState } from 'react'
import { Crosshair, Pause, Play, SkipBack } from 'lucide-react'

function fmt(s: number): string {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

interface AudioPlayerProps {
  src: string
  start?: number
  length?: number
  onSetStart?: (t: number) => void
}

/** Inline player that highlights (and can preview) the slice of audio a cut uses. */
export function AudioPlayer({ src, start = 0, length = 0, onSetStart }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [dragging, setDragging] = useState(false)
  const segmentEnd = useRef<number | null>(null) // when set, playback stops here (segment preview)

  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
  }, [src])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { segmentEnd.current = null; void a.play(); setPlaying(true) }
  }

  // Plays exactly the slice of audio the workflow will use: [start, start + length]
  const playSegment = () => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = start || 0
    setCurrent(a.currentTime)
    segmentEnd.current = length > 0 ? (start || 0) + length : null
    void a.play()
    setPlaying(true)
  }

  const onTimeUpdate = () => {
    const a = audioRef.current
    if (!a) return
    if (segmentEnd.current != null && a.currentTime >= segmentEnd.current) {
      a.pause(); setPlaying(false); segmentEnd.current = null
    }
    if (!dragging) setCurrent(a.currentTime)
  }

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    a.currentTime = ratio * duration
    setCurrent(a.currentTime)
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0
  const segLeft = duration > 0 ? Math.min(100, (start / duration) * 100) : 0
  const segWidth = duration > 0 ? Math.max(0, Math.min(100 - segLeft, (length / duration) * 100)) : 0
  const btn = 'flex items-center justify-center h-6 w-6 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-blue-400 hover:border-blue-500/60 shrink-0'

  return (
    <div className="flex items-center gap-2 mt-1.5 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />
      <button className={btn} onClick={playSegment} title="Play the segment used for this cut">
        <SkipBack className="h-3 w-3" />
      </button>
      <button className={btn} onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <span className="text-[10px] text-zinc-500 font-mono w-8 text-center shrink-0">{fmt(current)}</span>
      <div
        className="relative flex-1 h-4 cursor-pointer"
        onClick={onSeek}
        onMouseDown={e => { setDragging(true); onSeek(e) }}
        onMouseMove={e => { if (dragging && e.buttons === 1) onSeek(e) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        <div className="absolute top-1.5 left-0 right-0 h-1 bg-zinc-700 rounded" />
        {segWidth > 0 && (
          <div className="absolute top-1 h-2 rounded-sm bg-sky-400/30 border border-sky-400 pointer-events-none"
            style={{ left: `${segLeft}%`, width: `${segWidth}%` }} />
        )}
        <div className="absolute top-1.5 left-0 h-1 bg-blue-500 rounded pointer-events-none" style={{ width: `${pct}%` }} />
        <div className="absolute top-1 h-2 w-2 -translate-x-1/2 rounded-full bg-blue-400 pointer-events-none" style={{ left: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500 font-mono w-8 text-center shrink-0">{fmt(duration)}</span>
      {onSetStart && (
        <button className={btn} onClick={() => onSetStart(current)} title="Set Audio Start to playhead">
          <Crosshair className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
