import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Image, Music, X } from 'lucide-react'
import { useStoryboard } from '../../contexts/StoryboardContext'
import { errorText } from '../../lib/director-api'
import type { FsEntry } from '../../types/director'

export const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a']
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

interface FileBrowserModalProps {
  kind: 'image' | 'audio'
  onSelect: (path: string) => void
  onClose: () => void
}

/** Browses the Director host's filesystem (via /api/fs/browse) for an image or audio file. */
export function FileBrowserModal({ kind, onSelect, onClose }: FileBrowserModalProps) {
  const { api, project, projectName } = useStoryboard()
  const [fsPath, setFsPath] = useState<string | null>(null)
  const [fsParent, setFsParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const exts = kind === 'image' ? IMAGE_EXTS : AUDIO_EXTS
  const Icon = kind === 'image' ? Image : Music

  const load = useCallback(async (path: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.fsBrowse(path)
      setFsPath(res.path)
      setFsParent(res.parent)
      setEntries(res.entries.filter(e => e.is_dir || exts.includes(ext(e.name))))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [api, exts])

  useEffect(() => { void load(null) }, [load])

  const preview = kind === 'image' && selected && projectName && project ? api.fileUrl(projectName, selected) : null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] max-h-[75vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 text-sm font-semibold text-white">
          <Icon className="h-4 w-4" />
          <span>Select {kind === 'image' ? 'Source Image' : 'Audio File'}</span>
          <button className="ml-auto p-1 rounded hover:bg-zinc-800 text-zinc-400" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-400 bg-zinc-950/60 border-b border-zinc-800">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{fsPath ?? '…'}</span>
          {fsParent && fsParent !== fsPath && (
            <button className="ml-auto px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300 shrink-0" onClick={() => void load(fsParent)}>↑ Up</button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-center text-xs text-zinc-500">Loading…</div>}
          {error && <div className="p-6 text-center text-xs text-red-400">{error}</div>}
          {!loading && !error && entries.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">No {kind} files here</div>}
          {entries.map(e => (
            <div
              key={e.path}
              className={`flex items-center gap-2.5 px-4 py-2 text-xs border-b border-zinc-800/70 cursor-pointer text-zinc-200 ${selected === e.path ? 'bg-blue-500/20' : 'hover:bg-zinc-800'}`}
              onClick={() => e.is_dir ? void load(e.path) : setSelected(e.path)}
              onDoubleClick={() => !e.is_dir && onSelect(e.path)}
            >
              {e.is_dir
                ? <FolderOpen className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                : <Icon className="h-3.5 w-3.5 text-sky-400 shrink-0" />}
              <span className="truncate">{e.name}</span>
            </div>
          ))}
        </div>
        {preview && (
          <div className="h-36 bg-black border-t border-zinc-800 flex items-center justify-center">
            <img src={preview} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        )}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-zinc-800 bg-zinc-950/60">
          <span className="flex-1 text-xs text-zinc-500 truncate">{selected ? selected.split(/[\\/]/).pop() : 'Nothing selected'}</span>
          <button className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200" onClick={onClose}>Cancel</button>
          <button className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
            disabled={!selected} onClick={() => selected && onSelect(selected)}>Use File</button>
        </div>
      </div>
    </div>
  )
}
