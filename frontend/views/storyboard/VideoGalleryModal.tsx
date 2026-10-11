import { useState } from 'react'
import { Check, Video, X } from 'lucide-react'
import { useStoryboard } from '../../contexts/StoryboardContext'
import { fileBaseName } from '../../lib/director-api'
import type { DirectorCut } from '../../types/director'

interface VideoGalleryModalProps {
  cut: DirectorCut
  onSelect: (path: string) => void
  onClose: () => void
}

/** All takes generated for a cut; picking one makes it the cut's selected video (and its timeline clip). */
export function VideoGalleryModal({ cut, onSelect, onClose }: VideoGalleryModalProps) {
  const { api, projectName } = useStoryboard()
  const videos = [...(cut.generated_videos ?? [])].reverse() // newest first
  const [focused, setFocused] = useState<string | null>(cut.selected_video ?? videos[0] ?? null)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[880px] max-w-[92vw] max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 text-sm font-semibold text-white">
          <Video className="h-4 w-4" />
          <span>Takes for Cut {String(cut.order).padStart(2, '0')}</span>
          <span className="text-xs font-normal text-zinc-500">{videos.length} generated</span>
          <button className="ml-auto p-1 rounded hover:bg-zinc-800 text-zinc-400" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        {focused && projectName && (
          <div className="bg-black flex items-center justify-center h-[340px] border-b border-zinc-800">
            <video key={focused} src={api.fileUrl(projectName, focused)} className="max-h-full max-w-full" controls autoPlay loop />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-4 gap-3">
          {videos.length === 0 && <div className="col-span-4 p-6 text-center text-xs text-zinc-500">No takes generated yet</div>}
          {videos.map((v, i) => {
            const isSelected = v === cut.selected_video
            return (
              <button
                key={v}
                className={`relative text-left rounded-lg overflow-hidden border ${focused === v ? 'border-blue-500' : 'border-zinc-800 hover:border-zinc-600'}`}
                onClick={() => setFocused(v)}
                onDoubleClick={() => onSelect(v)}
                title={v}
              >
                {projectName && (
                  <video src={`${api.fileUrl(projectName, v)}#t=0.1`} className="w-full aspect-video object-cover bg-black" muted preload="metadata" />
                )}
                <div className="px-2 py-1 text-[10px] text-zinc-400 truncate">
                  Take {videos.length - i} · {fileBaseName(v)}
                </div>
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    <Check className="h-2.5 w-2.5" /> ON TIMELINE
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-zinc-800 bg-zinc-950/60">
          <span className="flex-1 text-xs text-zinc-500">The selected take is what appears on the Video Editor timeline.</span>
          <button className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200" onClick={onClose}>Close</button>
          <button className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
            disabled={!focused || focused === cut.selected_video} onClick={() => focused && onSelect(focused)}>
            Use This Take
          </button>
        </div>
      </div>
    </div>
  )
}
