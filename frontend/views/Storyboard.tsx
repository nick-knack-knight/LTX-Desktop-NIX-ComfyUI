import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, Clapperboard, Link2, Loader2, Plus, RefreshCw, Server, Settings, Trash2, Unlink, X,
} from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { useStoryboard } from '../contexts/StoryboardContext'
import { directorFolderName } from '../lib/director-api'
import { orderedSlots } from '../lib/storyboard-timeline'
import { CutCard } from './storyboard/CutCard'
import { StoryboardSettingsModal } from './storyboard/StoryboardSettingsModal'

function ConnectionSetup() {
  const { currentProject } = useProjects()
  const {
    serverUrl, setServerUrl, connection, refreshConnection, projects,
    linkProject, createAndLinkProject, error, clearError,
  } = useStoryboard()
  const [urlDraft, setUrlDraft] = useState(serverUrl)
  const [newName, setNewName] = useState(currentProject?.name ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setUrlDraft(serverUrl) }, [serverUrl])

  const existing = projects.find(p => p.name === directorFolderName(newName))

  return (
    <div className="h-full overflow-y-auto flex items-start justify-center p-10">
      <div className="w-[560px] flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Clapperboard className="h-5 w-5" /> Storyboard</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Link this project to an AI Video Director project. Its scenes and cuts drive generation through ComfyUI,
            and each cut's selected take is laid out in order on the Video Editor timeline.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wider text-zinc-500 flex items-center gap-1.5"><Server className="h-3.5 w-3.5" /> Video Director server</label>
          <div className="flex gap-2">
            <input className="flex-1 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setServerUrl(urlDraft) }}
              placeholder="http://127.0.0.1:8000" />
            <button className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-white"
              onClick={() => { if (urlDraft !== serverUrl) setServerUrl(urlDraft); else void refreshConnection() }}>
              Connect
            </button>
          </div>
          <div className="text-xs flex items-center gap-1.5">
            {connection === 'connected' && <><Check className="h-3.5 w-3.5 text-green-400" /><span className="text-green-400">Connected · {projects.length} project{projects.length === 1 ? '' : 's'}</span></>}
            {connection === 'disconnected' && <><AlertTriangle className="h-3.5 w-3.5 text-amber-400" /><span className="text-amber-400">Not reachable — is the Video Director backend running?</span></>}
            {connection === 'unknown' && <span className="text-zinc-500">Checking…</span>}
          </div>
        </div>

        {connection === 'connected' && (
          <>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-2">
              <label className="text-xs uppercase tracking-wider text-zinc-500">Create a new Director project</label>
              <div className="flex gap-2">
                <input className="flex-1 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  value={newName} onChange={e => setNewName(e.target.value)} placeholder="Project name" />
                <button className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-sm text-white disabled:opacity-40"
                  disabled={!newName.trim() || busy || !!existing}
                  onClick={async () => { setBusy(true); await createAndLinkProject(newName.trim()); setBusy(false) }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create & Link'}
                </button>
              </div>
              {existing && <span className="text-xs text-zinc-500">A Director project with this name exists — link it below.</span>}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <div className="px-4 py-2.5 text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">Or link an existing one</div>
              {projects.length === 0 && <div className="px-4 py-4 text-sm text-zinc-500">No Director projects yet.</div>}
              {projects.map(p => (
                <button key={p.name} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-800 border-b border-zinc-800/60 last:border-0"
                  onClick={() => void linkProject(p.name)}>
                  <Link2 className="h-4 w-4 text-zinc-500" />
                  <span className="text-sm text-white">{p.project_name ?? p.name}</span>
                  <span className="ml-auto text-xs text-zinc-500">{p.scene_count ?? 0} scene{p.scene_count === 1 ? '' : 's'}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span className="flex-1">{error}</span>
            <button onClick={clearError}><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </div>
  )
}

/** ComfyUI status chip; opens the settings modal. Checks the saved host when a project opens. */
function ComfyStatusChip() {
  const { project, projectName, comfyStatus, checkComfy } = useStoryboard()
  const [open, setOpen] = useState(false)
  const hasProject = !!project

  useEffect(() => {
    if (hasProject) void checkComfy()
  }, [projectName, hasProject]) // eslint-disable-line react-hooks/exhaustive-deps

  const dot = comfyStatus?.status === 'connected' ? 'bg-green-400' : comfyStatus?.status === 'disconnected' ? 'bg-red-400' : 'bg-zinc-600'
  const label = comfyStatus?.status === 'connected'
    ? comfyStatus.devices?.[0] ?? 'connected'
    : comfyStatus?.status === 'disconnected' ? 'not reachable' : 'checking…'
  return (
    <>
      <button className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-zinc-800 text-[11px] text-zinc-400 hover:text-white"
        title={`ComfyUI at ${project?.comfyui_host || '(not set)'}${comfyStatus?.error ? ` — ${comfyStatus.error}` : ''}`}
        onClick={() => setOpen(true)}>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span>ComfyUI</span>
        <span className="text-zinc-500 max-w-[220px] truncate">{label}</span>
        <Settings className="h-3.5 w-3.5 ml-0.5" />
      </button>
      {open && <StoryboardSettingsModal onClose={() => setOpen(false)} />}
    </>
  )
}

function SceneList() {
  const { project, activeSceneId, selectScene, createScene, renameScene, deleteScene } = useStoryboard()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  if (!project) return null

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-950/40">
      <div className="flex items-center px-3 py-2.5 border-b border-zinc-800">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Scenes</span>
        <button className="ml-auto p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Add scene"
          onClick={() => void createScene(`Scene ${project.scenes.length + 1}`)}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {project.scenes.map((scene, i) => {
          const total = scene.cuts.reduce((s, c) => s + (c.length > 0 ? c.length : 0), 0)
          const active = scene.id === activeSceneId
          return (
            <div key={scene.id}
              className={`group mx-1.5 my-0.5 px-2.5 py-2 rounded-md cursor-pointer ${active ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
              onClick={() => selectScene(scene.id)}
              onDoubleClick={() => { setEditing(scene.id); setDraft(scene.name) }}>
              {editing === scene.id ? (
                <input autoFocus className="w-full rounded bg-zinc-950 border border-blue-500 px-1.5 py-0.5 text-sm text-white focus:outline-none"
                  value={draft} onChange={e => setDraft(e.target.value)}
                  onBlur={() => { if (draft.trim()) renameScene(scene.id, draft.trim()); setEditing(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }} />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-500">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sm truncate flex-1">{scene.name}</span>
                  <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-red-400 hover:bg-red-500/10" title="Delete scene"
                    onClick={e => { e.stopPropagation(); if (confirm(`Delete scene "${scene.name}" and its cuts?`)) void deleteScene(scene.id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="text-[10px] text-zinc-500 mt-0.5 pl-6">{scene.cuts.length} cut{scene.cuts.length === 1 ? '' : 's'} · {total.toFixed(1)}s</div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/** Proportional strip of every cut in film order — the same order the timeline uses. */
function FilmStrip() {
  const { project, activeCutId, selectCut, jobs } = useStoryboard()
  const slots = useMemo(() => orderedSlots(project), [project])
  const total = slots.reduce((s, x) => s + x.duration, 0)
  if (slots.length === 0) return null
  return (
    <div className="shrink-0 border-t border-zinc-800 px-4 py-2.5 bg-zinc-950/60">
      <div className="flex items-center text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
        <span>Film order</span>
        <span className="ml-auto normal-case tracking-normal">{slots.length} cuts · {total.toFixed(1)}s</span>
      </div>
      <div className="flex h-7 gap-px rounded overflow-hidden">
        {slots.map((s, i) => {
          const sceneStart = i === 0 || slots[i - 1].sceneId !== s.sceneId
          const busy = jobs[s.cut.id] && !['done', 'error', 'cancelled'].includes(jobs[s.cut.id].status)
          return (
            <button key={s.cut.id}
              className={`relative min-w-[6px] text-[9px] truncate px-1 ${s.cut.selected_video ? 'bg-blue-600/70 text-white' : 'bg-zinc-800 text-zinc-400 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.04)_4px,rgba(255,255,255,0.04)_8px)]'} ${activeCutId === s.cut.id ? 'ring-2 ring-inset ring-white' : ''} ${sceneStart && i > 0 ? 'ml-1' : ''}`}
              style={{ flexGrow: s.duration, flexBasis: 0 }}
              title={`${s.sceneName} · Cut ${s.cut.order} · ${s.duration}s${s.cut.selected_video ? '' : ' (no video yet — gap on timeline)'}`}
              onClick={() => selectCut(s.sceneId, s.cut.id)}>
              {busy && <Loader2 className="inline h-2.5 w-2.5 mr-0.5 animate-spin" />}
              {s.cut.order}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Storyboard() {
  const {
    projectName, project, loading, saving, error, clearError, activeSceneId, activeCutId,
    addCut, reloadProject, unlinkProject,
  } = useStoryboard()

  // Scroll the selected cut into view (e.g. when jumping here from the timeline)
  useEffect(() => {
    if (!activeCutId) return
    document.getElementById(`storyboard-cut-${activeCutId}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeCutId, activeSceneId])

  if (!projectName) return <ConnectionSetup />

  if (!project) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-zinc-400">
        {loading ? <><Loader2 className="h-5 w-5 animate-spin" /> Loading storyboard…</> : (
          <>
            <span className="text-red-300 max-w-lg text-center">{error ?? 'Storyboard not loaded.'}</span>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white" onClick={() => void reloadProject()}>Retry</button>
              <button className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white" onClick={unlinkProject}>Change link</button>
            </div>
          </>
        )}
      </div>
    )
  }

  const scene = project.scenes.find(s => s.id === activeSceneId) ?? null
  const cuts = scene ? [...scene.cuts].sort((a, b) => a.order - b.order) : []

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-sm text-white">
          <Clapperboard className="h-4 w-4 text-zinc-400" />
          <span className="font-medium">{project.project_name ?? projectName}</span>
          {saving && <span className="text-[11px] text-zinc-500 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> saving</span>}
        </div>
        <ComfyStatusChip />
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Reload from Director" onClick={() => void reloadProject()}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white" title="Unlink Director project" onClick={unlinkProject}>
            <Unlink className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-300 px-4 py-1.5 bg-red-500/10 border-b border-red-500/25">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span className="flex-1">{error}</span>
          <button onClick={clearError}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <SceneList />
        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-auto">
          {!scene ? (
            <div className="h-full flex items-center justify-center text-sm text-zinc-500">Add a scene to start your storyboard.</div>
          ) : (
            <div className="flex items-start gap-4 p-4 w-max">
              {cuts.map((cut, i) => (
                <div key={cut.id} id={`storyboard-cut-${cut.id}`}>
                  <CutCard cut={cut} sceneId={scene.id} isActive={cut.id === activeCutId}
                    isFirst={i === 0} isLast={i === cuts.length - 1} />
                </div>
              ))}
              <button
                className="w-[200px] h-[200px] shrink-0 rounded-xl border-2 border-dashed border-zinc-800 hover:border-blue-500/60 text-zinc-500 hover:text-blue-300 flex flex-col items-center justify-center gap-2"
                onClick={() => void addCut(scene.id)}>
                <Plus className="h-6 w-6" />
                <span className="text-sm">Add Cut</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <FilmStrip />
    </div>
  )
}
