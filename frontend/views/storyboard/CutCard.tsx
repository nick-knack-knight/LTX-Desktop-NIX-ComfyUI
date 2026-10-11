import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, ChevronLeft, ChevronRight, FolderOpen, Image, Music, RefreshCw, Sparkles, Square, Trash2, Video, X, Zap,
} from 'lucide-react'
import { useStoryboard } from '../../contexts/StoryboardContext'
import { errorText, fileBaseName } from '../../lib/director-api'
import type { CropPosition, DirectorCut } from '../../types/director'
import { ACTIVE_JOB_STATUSES } from '../../types/director'
import { AudioPlayer } from './AudioPlayer'
import { FileBrowserModal } from './FileBrowserModal'
import { VideoGalleryModal } from './VideoGalleryModal'

const CROP_OPTIONS: CropPosition[] = ['top', 'center', 'bottom', 'left', 'right']

const labelCls = 'block text-[10px] uppercase tracking-wider text-zinc-500 mb-1'
const inputCls = 'w-full rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500'

interface CutCardProps {
  cut: DirectorCut
  sceneId: string
  isActive: boolean
  isFirst: boolean
  isLast: boolean
}

export function CutCard({ cut, sceneId, isActive, isFirst, isLast }: CutCardProps) {
  const {
    api, projectName, workflows: availableWorkflows, jobs,
    updateCut, deleteCut, moveCut, selectCut, saveProject,
    startGeneration, cancelGeneration, dismissJob, enhancePrompt,
  } = useStoryboard()
  const job = jobs[cut.id]

  const [showImageBrowser, setShowImageBrowser] = useState(false)
  const [showVideoGallery, setShowVideoGallery] = useState(false)
  const [showAudioBrowser, setShowAudioBrowser] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Workflows come from the Director's workflows/*.json; the cut's current value is kept even if missing
  const workflows = availableWorkflows.filter(w => w.kind !== 'enhance').map(w => w.name)
  const workflowMissing = !!cut.workflow && workflows.length > 0 && !workflows.includes(cut.workflow)
  const wfInfo = availableWorkflows.find(w => w.name === cut.workflow)
  const missingInputs = (wfInfo?.requires ?? []).filter(k =>
    k === 'image' ? !cut.source_image : k === 'audio' ? !cut.audio_file : k === 'prompt' ? !(cut.enhanced_prompt || cut.prompt) : false)

  const generating = !!job && ACTIVE_JOB_STATUSES.has(job.status)
  const stepPct = job?.steps ? ((job.step ?? 0) / job.steps) * 100
    : job?.nodes_total ? ((job.nodes_done ?? 0) / job.nodes_total) * 100 : 0
  const elapsed = job?.started_at ? Math.max(0, Math.round(now / 1000 - job.started_at)) : null

  // Tick the elapsed timer while a render is running
  useEffect(() => {
    if (!generating) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [generating])

  useEffect(() => { setImgError(false) }, [cut.source_image])

  const update = useCallback((patch: Partial<DirectorCut>) => {
    updateCut(sceneId, cut.id, patch)
  }, [sceneId, cut.id, updateCut])

  const save = () => { void saveProject() }

  const handleEnhancePrompt = async () => {
    if (!cut.prompt.trim()) return
    setEnhancing(true)
    setEnhanceError(null)
    try {
      await enhancePrompt(sceneId, cut.id)
    } catch (e) {
      setEnhanceError(errorText(e))
    } finally {
      setEnhancing(false)
    }
  }

  const fileUrl = (p: string) => (projectName ? api.fileUrl(projectName, p) : '')
  const thumbUrl = cut.source_image ? fileUrl(cut.source_image) : null
  const videoUrl = cut.selected_video ? fileUrl(cut.selected_video) : null
  const videoCount = cut.generated_videos?.length ?? 0
  const audioName = cut.audio_file ? fileBaseName(cut.audio_file) : null
  const promptValue = cut.enhanced_prompt ?? cut.prompt

  return (
    <div
      className={`flex flex-col w-[360px] min-w-[360px] shrink-0 rounded-xl border bg-zinc-900 overflow-hidden transition-colors cursor-pointer ${
        isActive ? 'border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.4)]' : 'border-zinc-800 hover:border-zinc-700'
      }`}
      onClick={() => selectCut(sceneId, cut.id)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/60">
        <span className={`text-[11px] font-bold tracking-[0.12em] ${isActive ? 'text-blue-400' : 'text-zinc-400'}`}>
          CUT {String(cut.order).padStart(2, '0')}
        </span>
        {cut.length > 0 && <span className="text-[10px] text-zinc-500 px-1.5 border border-zinc-800 rounded-sm">{cut.length}s</span>}
        {cut.selected_video && <span className="text-[9px] text-blue-300/80 uppercase tracking-wider">on timeline</span>}
        <div className="ml-auto flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          <button className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 disabled:opacity-30" disabled={isFirst}
            onClick={() => moveCut(sceneId, cut.id, -1)} title="Move earlier">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 disabled:opacity-30" disabled={isLast}
            onClick={() => moveCut(sceneId, cut.id, 1)} title="Move later">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button className="p-1 rounded text-red-400 hover:bg-red-500/10" onClick={() => deleteCut(sceneId, cut.id)} title="Delete cut">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Media previews */}
      <div className="flex flex-col gap-2 px-3 pt-3 pb-1">
        <div>
          <div className={labelCls}>Source Image</div>
          <div className="group relative h-[170px] rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden cursor-pointer hover:border-blue-500/50"
            onClick={e => { e.stopPropagation(); setShowImageBrowser(true) }}>
            {thumbUrl && !imgError
              ? <img src={thumbUrl} alt="source" className="w-full h-full object-cover" onError={() => setImgError(true)} />
              : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-zinc-500 text-[11px]">
                  <Image className="h-7 w-7" />
                  <span>{imgError ? 'Load error — click to retry' : 'Click to select'}</span>
                </div>}
            <div className="absolute inset-0 bg-black/65 flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity">
              <Image className="h-3.5 w-3.5" /> Change Image
            </div>
          </div>
        </div>

        <div>
          <div className={`${labelCls} flex items-center`}>
            Output Video
            {videoCount > 0 && <span className="ml-auto rounded-sm bg-blue-600 text-white text-[9px] font-bold px-1.5 normal-case tracking-normal">{videoCount} gen</span>}
          </div>
          <div className="group relative h-[170px] rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden cursor-pointer hover:border-blue-500/50"
            onClick={e => { e.stopPropagation(); setShowVideoGallery(true) }}>
            {videoUrl
              ? <video key={videoUrl} src={`${videoUrl}#t=0.1`} className="w-full h-full object-cover" muted preload="metadata" />
              : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-zinc-500 text-[11px]">
                  <Video className="h-7 w-7" /><span>No video yet</span>
                </div>}
            <div className="absolute inset-0 bg-black/65 flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity">
              <Video className="h-3.5 w-3.5" /> Browse Takes
            </div>
          </div>
        </div>
      </div>

      {/* Generate */}
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-2.5 border-b border-zinc-800" onClick={e => e.stopPropagation()}>
        {generating && job ? (
          <>
            <div className="flex items-center gap-2 text-[11px] text-blue-300">
              <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {job.message || (job.status === 'running' ? 'Running' : job.status)}
                {job.status === 'running' && job.steps ? ` · step ${job.step}/${job.steps}` : ''}
              </span>
              {elapsed != null && <span className="text-[10px] text-zinc-500 font-mono">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>}
              <button className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25 text-[11px]"
                onClick={() => void cancelGeneration(cut.id)} title="Cancel">
                <Square className="h-2.5 w-2.5" /> Stop
              </button>
            </div>
            <div className="h-1 bg-zinc-800 rounded overflow-hidden">
              <div className="h-full bg-blue-500 transition-[width] duration-300" style={{ width: `${stepPct}%` }} />
            </div>
            {!!job.nodes_total && (
              <div className="text-[10px] text-zinc-500">nodes {job.nodes_done}/{job.nodes_total}{job.seed ? ` · seed ${job.seed}` : ''}</div>
            )}
          </>
        ) : (
          <>
            <button
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={missingInputs.length > 0}
              title={missingInputs.length ? `Needs: ${missingInputs.join(', ')}` : 'Send this cut to ComfyUI'}
              onClick={() => void startGeneration(sceneId, cut.id)}
            >
              <Zap className="h-3.5 w-3.5" /> {videoCount > 0 ? 'Generate Another Take' : 'Generate Video'}
            </button>
            {missingInputs.length > 0 && (
              <div className="text-[10px] text-zinc-500 text-center">Needs {missingInputs.join(' + ')} for {cut.workflow}</div>
            )}
            {job?.status === 'error' && (
              <div className="flex items-start gap-1.5 text-[11px] text-red-300 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/25 break-words">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="flex-1">{job.error}</span>
                <button className="p-0.5 rounded hover:bg-red-500/20" onClick={() => dismissJob(cut.id)}><X className="h-2.5 w-2.5" /></button>
              </div>
            )}
            {job?.status === 'cancelled' && <div className="text-[10px] text-zinc-500 text-center">Cancelled</div>}
          </>
        )}
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-2.5 p-3" onClick={e => e.stopPropagation()}>
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <label className={labelCls}>Prompt</label>
            <textarea
              className={`${inputCls} resize-y min-h-[110px] leading-relaxed`}
              value={promptValue}
              onChange={e => update(cut.enhanced_prompt != null ? { enhanced_prompt: e.target.value } : { prompt: e.target.value })}
              onBlur={save}
              placeholder="Describe the shot..."
              rows={6}
            />
            {cut.enhanced_prompt && (
              <div className="mt-1 px-1.5 py-1 text-[10px] italic text-zinc-500 bg-zinc-950 border-l-2 border-zinc-700 rounded truncate" title={cut.prompt}>
                ✦ orig: {cut.prompt.slice(0, 60)}{cut.prompt.length > 60 ? '…' : ''}
              </div>
            )}
          </div>
          <button
            className="mt-5 h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-blue-500/40 text-blue-300 hover:bg-blue-500/10 disabled:opacity-35 disabled:cursor-not-allowed"
            title="Enhance prompt with AI"
            onClick={() => void handleEnhancePrompt()}
            disabled={enhancing || !cut.prompt.trim()}
          >
            {enhancing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </button>
        </div>
        {enhanceError && (
          <div className="flex items-start gap-1.5 text-[11px] text-red-300 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/25">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span>{enhanceError}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls}>Workflow</label>
            <select className={inputCls} value={cut.workflow} title={wfInfo?.description ?? ''}
              onChange={e => { update({ workflow: e.target.value }); save() }}>
              {workflows.length === 0 && <option value={cut.workflow}>{cut.workflow} (no workflows found)</option>}
              {workflowMissing && <option value={cut.workflow}>{cut.workflow} (missing)</option>}
              {workflows.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Seed (-1 = random)</label>
            <input className={inputCls} type="number" value={cut.seed}
              onChange={e => update({ seed: parseInt(e.target.value, 10) })} onBlur={save} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className={labelCls}>Width</label>
            <input className={inputCls} type="number" step={64} value={cut.width}
              onChange={e => update({ width: parseInt(e.target.value, 10) })} onBlur={save} />
          </div>
          <div>
            <label className={labelCls}>Height</label>
            <input className={inputCls} type="number" step={64} value={cut.height}
              onChange={e => update({ height: parseInt(e.target.value, 10) })} onBlur={save} />
          </div>
          <div>
            <label className={labelCls}>Length (s)</label>
            <input className={inputCls} type="number" min={1} max={30} step={0.5} value={cut.length}
              onChange={e => update({ length: parseFloat(e.target.value) })} onBlur={save} />
          </div>
          <div>
            <label className={labelCls}>Crop</label>
            <select className={inputCls} value={cut.crop_position} onChange={e => { update({ crop_position: e.target.value as CropPosition }); save() }}>
              {CROP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Audio File</label>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] bg-zinc-950 border border-zinc-800 rounded-md">
            <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] truncate">
              {audioName
                ? <><Music className="h-3 w-3 text-sky-400 shrink-0" /><span className="truncate text-zinc-200">{audioName}</span></>
                : <span className="text-zinc-500">No audio selected</span>}
            </div>
            <button className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200" onClick={() => setShowAudioBrowser(true)}>
              <FolderOpen className="h-3 w-3" /> Browse
            </button>
            {cut.audio_file && (
              <button className="p-1 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25" onClick={() => { update({ audio_file: null }); save() }}>
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {cut.audio_file && (
            <>
              <AudioPlayer
                src={fileUrl(cut.audio_file)}
                start={cut.audio_start ?? 0}
                length={cut.length ?? 0}
                onSetStart={t => { update({ audio_start: Math.round(t * 100) / 100 }); save() }}
              />
              <div className="flex items-center gap-2 mt-1.5">
                <label className="text-[10px] uppercase tracking-wider text-zinc-500">Audio Start (s)</label>
                <input className={`${inputCls} w-20`} type="number" min={0} step={0.1} value={cut.audio_start ?? 0}
                  onChange={e => update({ audio_start: parseFloat(e.target.value) || 0 })} onBlur={save} />
                <span className="text-[10px] text-zinc-500">
                  uses {(cut.audio_start ?? 0).toFixed(1)}s → {((cut.audio_start ?? 0) + (cut.length ?? 0)).toFixed(1)}s
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {showImageBrowser && (
        <FileBrowserModal kind="image"
          onSelect={p => { update({ source_image: p }); setShowImageBrowser(false); save() }}
          onClose={() => setShowImageBrowser(false)} />
      )}
      {showVideoGallery && (
        <VideoGalleryModal cut={cut}
          onSelect={p => { update({ selected_video: p }); setShowVideoGallery(false); save() }}
          onClose={() => setShowVideoGallery(false)} />
      )}
      {showAudioBrowser && (
        <FileBrowserModal kind="audio"
          onSelect={p => { update({ audio_file: p }); setShowAudioBrowser(false); save() }}
          onClose={() => setShowAudioBrowser(false)} />
      )}
    </div>
  )
}
