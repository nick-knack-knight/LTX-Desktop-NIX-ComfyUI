import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Image, Music, Upload, Video, X } from 'lucide-react'
import { useStoryboard } from '../../contexts/StoryboardContext'
import { errorText, fileBaseName } from '../../lib/director-api'
import type { FsEntry } from '../../types/director'

export const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a']
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp']
export const VIDEO_EXTS = ['.mp4', '.webm', '.mov']

type Kind = 'image' | 'audio' | 'video'

const KIND_INFO: Record<Kind, { exts: string[]; icon: typeof Image; title: string }> = {
  image: { exts: IMAGE_EXTS, icon: Image, title: 'Select Source Image' },
  audio: { exts: AUDIO_EXTS, icon: Music, title: 'Select Audio File' },
  video: { exts: VIDEO_EXTS, icon: Video, title: 'Import Video' },
}

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

interface FileBrowserModalProps {
  kind: Kind
  /** Images only: enables the project's source_images tab and uploads into it */
  sceneId?: string
  onSelect: (path: string) => void
  onClose: () => void
}

/**
 * Picks a file for a cut. Images default to the Director project's source_images/
 * folder (project-relative paths); every kind can also browse the Director host's
 * disk via /api/fs/browse (absolute paths, which the Director resolves as-is).
 */
export function FileBrowserModal({ kind, sceneId, onSelect, onClose }: FileBrowserModalProps) {
  const { api, projectName } = useStoryboard()
  const projectTab = kind === 'image' && !!sceneId && !!projectName
  const [tab, setTab] = useState<'project' | 'disk'>(projectTab ? 'project' : 'disk')
  const [fsPath, setFsPath] = useState<string | null>(null)
  const [fsParent, setFsParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const { exts, icon: Icon, title } = KIND_INFO[kind]

  const loadDisk = useCallback(async (path: string | null) => {
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

  const loadProject = useCallback(async (subpath: string) => {
    if (!projectName) return
    setLoading(true)
    setError(null)
    try {
      const files = await api.browseImages(projectName, subpath)
      setFsPath(subpath ? `source_images/${subpath}` : 'source_images')
      setFsParent(subpath ? subpath.split('/').slice(0, -1).join('/') : null)
      setEntries(files.map(f => ({ name: f.name, path: f.path, is_dir: !!f.is_dir })))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [api, projectName])

  useEffect(() => {
    setSelected(null)
    if (tab === 'project') void loadProject('')
    else void loadDisk(null)
  }, [tab, loadProject, loadDisk])

  // Project-tab dirs come back as "source_images/<sub>"; browseImages wants "<sub>"
  const openDir = (e: FsEntry) => {
    if (tab === 'project') void loadProject(e.path.replace(/^source_images\/?/, ''))
    else void loadDisk(e.path)
  }
  const goUp = () => {
    if (tab === 'project') void loadProject(fsParent ?? '')
    else void loadDisk(fsParent)
  }

  const upload = async () => {
    if (!projectName || !sceneId) return
    const picked = await window.electronAPI.showOpenFileDialog({
      title: 'Upload image to project',
      filters: [{ name: 'Images', extensions: IMAGE_EXTS.map(x => x.slice(1)) }],
    })
    if (!picked?.length) return
    setUploading(true)
    setError(null)
    try {
      const { data, mimeType } = await window.electronAPI.readLocalFile(picked[0])
      const { path } = await api.uploadImage(projectName, sceneId, base64ToBlob(data, mimeType), fileBaseName(picked[0]))
      onSelect(path)
    } catch (e) {
      setError(`Upload failed: ${errorText(e)}`)
    } finally {
      setUploading(false)
    }
  }

  const preview = kind === 'image' && selected && projectName ? api.fileUrl(projectName, selected) : null
  const canGoUp = tab === 'project' ? fsParent !== null : !!fsParent && fsParent !== fsPath
  const tabCls = (t: 'project' | 'disk') =>
    `px-2.5 py-1 rounded-md text-xs ${tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] max-h-[75vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 text-sm font-semibold text-white">
          <Icon className="h-4 w-4" />
          <span>{title}</span>
          {projectTab && (
            <div className="ml-3 flex gap-1 bg-zinc-800/60 rounded-md p-0.5">
              <button className={tabCls('project')} onClick={() => setTab('project')}>Project images</button>
              <button className={tabCls('disk')} onClick={() => setTab('disk')}>Browse disk</button>
            </div>
          )}
          <button className="ml-auto p-1 rounded hover:bg-zinc-800 text-zinc-400" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-400 bg-zinc-950/60 border-b border-zinc-800">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{fsPath ?? '…'}</span>
          {canGoUp && (
            <button className="ml-auto px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-300 shrink-0" onClick={goUp}>↑ Up</button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-center text-xs text-zinc-500">Loading…</div>}
          {error && <div className="p-6 text-center text-xs text-red-400">{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="p-6 text-center text-xs text-zinc-500">
              {tab === 'project' ? 'No images in this project yet — upload one or browse the disk.' : `No ${kind} files here`}
            </div>
          )}
          {entries.map(e => (
            <div
              key={e.path}
              className={`flex items-center gap-2.5 px-4 py-2 text-xs border-b border-zinc-800/70 cursor-pointer text-zinc-200 ${selected === e.path ? 'bg-blue-500/20' : 'hover:bg-zinc-800'}`}
              onClick={() => e.is_dir ? openDir(e) : setSelected(e.path)}
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
          {projectTab && (
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40"
              disabled={uploading} onClick={() => void upload()} title="Copy an image from this computer into the project">
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload…'}
            </button>
          )}
          <span className="flex-1 text-xs text-zinc-500 truncate">{selected ? fileBaseName(selected) : 'Nothing selected'}</span>
          <button className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200" onClick={onClose}>Cancel</button>
          <button className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
            disabled={!selected} onClick={() => selected && onSelect(selected)}>{kind === 'video' ? 'Import' : 'Use File'}</button>
        </div>
      </div>
    </div>
  )
}
