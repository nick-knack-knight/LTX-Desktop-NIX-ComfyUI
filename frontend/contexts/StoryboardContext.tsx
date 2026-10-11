// Storyboard state: the linked Video Director project, its scenes/cuts, and ComfyUI jobs.
// Port of the Director's zustand store to a React context. The project object is
// mirrored in a ref so async actions always read and save the latest version.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  DirectorApi, directorFolderName, errorText, loadDirectorServerUrl, normalizeServerUrl, saveDirectorServerUrl,
} from '../lib/director-api'
import type {
  ComfyStatus, DirectorConnection, DirectorCut, DirectorJob, DirectorProject, DirectorProjectSummary, DirectorWorkflowInfo,
} from '../types/director'
import { FINISHED_JOB_STATUSES } from '../types/director'
import { logger } from '../lib/logger'

interface StoryboardContextValue {
  api: DirectorApi
  serverUrl: string
  setServerUrl: (url: string) => void
  connection: DirectorConnection
  refreshConnection: () => Promise<void>

  projects: DirectorProjectSummary[]
  /** Director folder name linked to the current LTX project, if any */
  projectName: string | null
  project: DirectorProject | null
  loading: boolean
  saving: boolean
  error: string | null
  clearError: () => void
  linkProject: (name: string) => Promise<void>
  createAndLinkProject: (displayName: string) => Promise<void>
  unlinkProject: () => void
  reloadProject: () => Promise<void>
  saveProject: () => Promise<void>

  workflows: DirectorWorkflowInfo[]
  jobs: Record<string, DirectorJob>

  activeSceneId: string | null
  activeCutId: string | null
  selectScene: (id: string) => void
  selectCut: (sceneId: string, cutId: string | null) => void

  createScene: (name: string) => Promise<void>
  renameScene: (sceneId: string, name: string) => void
  deleteScene: (sceneId: string) => Promise<void>

  addCut: (sceneId: string, opts?: { beforeCutId?: string; patch?: Partial<DirectorCut> }) => Promise<DirectorCut | null>
  updateCut: (sceneId: string, cutId: string, patch: Partial<DirectorCut>) => void
  deleteCut: (sceneId: string, cutId: string) => void
  moveCut: (sceneId: string, cutId: string, delta: -1 | 1) => void

  updateComfyHost: (host: string) => void
  comfyStatus: ComfyStatus | null
  /** Test a ComfyUI host (defaults to the project's); saves it when it answers */
  checkComfy: (host?: string) => Promise<ComfyStatus | null>
  refreshWorkflows: () => Promise<void>
  importVideo: (sceneId: string, cutId: string, srcPath: string) => Promise<string | null>

  startGeneration: (sceneId: string, cutId: string) => Promise<void>
  cancelGeneration: (cutId: string) => Promise<void>
  dismissJob: (cutId: string) => void
  enhancePrompt: (sceneId: string, cutId: string) => Promise<void>
}

const StoryboardContext = createContext<StoryboardContextValue | null>(null)

function findCut(project: DirectorProject, cutId: string): DirectorCut | undefined {
  for (const scene of project.scenes) {
    const cut = scene.cuts.find(c => c.id === cutId)
    if (cut) return cut
  }
  return undefined
}

interface StoryboardProviderProps {
  children: React.ReactNode
  /** Director folder linked to the open LTX project (persisted on the LTX project) */
  linkedProject: string | null
  onLinkChange: (name: string | null) => void
}

export function StoryboardProvider({ children, linkedProject, onLinkChange }: StoryboardProviderProps) {
  const [serverUrl, setServerUrlState] = useState(loadDirectorServerUrl)
  const api = useMemo(() => new DirectorApi(serverUrl), [serverUrl])
  const [connection, setConnection] = useState<DirectorConnection>('unknown')
  const [projects, setProjects] = useState<DirectorProjectSummary[]>([])
  const [project, setProject] = useState<DirectorProject | null>(null)
  const projectRef = useRef<DirectorProject | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workflows, setWorkflows] = useState<DirectorWorkflowInfo[]>([])
  const [jobs, setJobs] = useState<Record<string, DirectorJob>>({})
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [activeCutId, setActiveCutId] = useState<string | null>(null)
  const [comfyStatus, setComfyStatus] = useState<ComfyStatus | null>(null)

  // Bumped whenever the linked project changes so stale async work can bail out
  const sessionRef = useRef(0)
  const pollingRef = useRef(new Set<string>())
  const projectName = linkedProject

  const commitProject = useCallback((next: DirectorProject | null) => {
    projectRef.current = next
    setProject(next)
  }, [])

  const mutateProject = useCallback((fn: (p: DirectorProject) => void) => {
    const current = projectRef.current
    if (!current) return
    const next = structuredClone(current)
    fn(next)
    commitProject(next)
  }, [commitProject])

  const saveProject = useCallback(async () => {
    const current = projectRef.current
    if (!current || !projectName) return
    setSaving(true)
    try {
      await api.updateProject(projectName, current)
    } catch (e) {
      setError(`Save failed: ${errorText(e)}`)
    } finally {
      setSaving(false)
    }
  }, [api, projectName])

  const setServerUrl = useCallback((url: string) => {
    const normalized = normalizeServerUrl(url)
    saveDirectorServerUrl(normalized)
    setServerUrlState(normalized)
  }, [])

  const refreshConnection = useCallback(async () => {
    try {
      setProjects(await api.listProjects())
      setConnection('connected')
    } catch (e) {
      setConnection('disconnected')
      logger.warn(`Video Director unreachable: ${errorText(e)}`)
    }
  }, [api])

  useEffect(() => { void refreshConnection() }, [refreshConnection])

  // ── Job polling ─────────────────────────────────────────────────────────────
  const pollJob = useCallback((jobId: string) => {
    if (pollingRef.current.has(jobId)) return
    pollingRef.current.add(jobId)
    const session = sessionRef.current
    const tick = async () => {
      if (session !== sessionRef.current) { pollingRef.current.delete(jobId); return }
      let job: DirectorJob
      try {
        job = await api.getJob(jobId)
      } catch (e) {
        if (e instanceof Error && 'status' in e && (e as { status: number | null }).status === 404) {
          pollingRef.current.delete(jobId) // backend restarted
          return
        }
        setTimeout(() => { void tick() }, 3000)
        return
      }
      if (session !== sessionRef.current) { pollingRef.current.delete(jobId); return }
      setJobs(prev => ({ ...prev, [job.cut_id]: job }))
      if (!FINISHED_JOB_STATUSES.has(job.status)) {
        setTimeout(() => { void tick() }, 1500)
        return
      }
      pollingRef.current.delete(jobId)
      const paths = job.result?.paths ?? []
      if (job.status === 'done' && paths.length > 0) {
        // The backend already wrote these into project.json; mirror them in memory
        mutateProject(p => {
          const cut = findCut(p, job.cut_id)
          if (!cut) return
          const vids = cut.generated_videos ?? []
          for (const path of paths) if (!vids.includes(path)) vids.push(path)
          cut.generated_videos = vids
          cut.selected_video = paths[0]
        })
      }
    }
    void tick()
  }, [api, mutateProject])

  // ── Project loading ─────────────────────────────────────────────────────────
  const loadProject = useCallback(async (name: string) => {
    const session = ++sessionRef.current
    pollingRef.current.clear()
    setLoading(true)
    setError(null)
    setJobs({})
    setComfyStatus(null)
    try {
      const proj = await api.getProject(name)
      if (session !== sessionRef.current) return
      proj.scenes = proj.scenes ?? []
      proj.workflows = proj.workflows ?? []
      commitProject(proj)
      setActiveSceneId(prev => (prev && proj.scenes.some(s => s.id === prev)) ? prev : proj.scenes[0]?.id ?? null)
      setConnection('connected')
      try { setWorkflows(await api.listWorkflows()) } catch { /* optional */ }
      // Resume tracking renders started before a reload
      try {
        const active = await api.listJobs(name, true)
        if (session !== sessionRef.current) return
        for (const job of active) {
          setJobs(prev => ({ ...prev, [job.cut_id]: job }))
          if (job.id) pollJob(job.id)
        }
      } catch { /* optional */ }
    } catch (e) {
      if (session !== sessionRef.current) return
      commitProject(null)
      setError(`Could not open Director project "${name}": ${errorText(e)}`)
    } finally {
      if (session === sessionRef.current) setLoading(false)
    }
  }, [api, commitProject, pollJob])

  useEffect(() => {
    if (linkedProject) {
      void loadProject(linkedProject)
    } else {
      sessionRef.current++
      commitProject(null)
      setJobs({})
    }
  }, [linkedProject, loadProject, commitProject])

  const reloadProject = useCallback(async () => {
    if (projectName) await loadProject(projectName)
  }, [projectName, loadProject])

  const linkProject = useCallback(async (name: string) => {
    onLinkChange(name)
  }, [onLinkChange])

  const createAndLinkProject = useCallback(async (displayName: string) => {
    try {
      await api.createProject(displayName)
      await refreshConnection()
      onLinkChange(directorFolderName(displayName))
    } catch (e) {
      setError(`Could not create Director project: ${errorText(e)}`)
    }
  }, [api, onLinkChange, refreshConnection])

  const unlinkProject = useCallback(() => onLinkChange(null), [onLinkChange])

  // ── Selection ───────────────────────────────────────────────────────────────
  const selectScene = useCallback((id: string) => {
    setActiveSceneId(id)
    setActiveCutId(null)
  }, [])

  const selectCut = useCallback((sceneId: string, cutId: string | null) => {
    setActiveSceneId(sceneId)
    setActiveCutId(cutId)
  }, [])

  // ── Scenes ──────────────────────────────────────────────────────────────────
  const createScene = useCallback(async (name: string) => {
    if (!projectName) return
    try {
      const scene = await api.createScene(projectName, name)
      scene.cuts = scene.cuts ?? []
      mutateProject(p => { p.scenes.push(scene) })
      setActiveSceneId(scene.id)
    } catch (e) {
      setError(`Could not create scene: ${errorText(e)}`)
    }
  }, [api, projectName, mutateProject])

  const renameScene = useCallback((sceneId: string, name: string) => {
    mutateProject(p => {
      const s = p.scenes.find(sc => sc.id === sceneId)
      if (s) s.name = name
    })
    void saveProject()
  }, [mutateProject, saveProject])

  const deleteScene = useCallback(async (sceneId: string) => {
    if (!projectName) return
    try {
      await api.deleteScene(projectName, sceneId)
      mutateProject(p => { p.scenes = p.scenes.filter(sc => sc.id !== sceneId) })
      setActiveSceneId(prev => prev === sceneId ? projectRef.current?.scenes[0]?.id ?? null : prev)
    } catch (e) {
      setError(`Could not delete scene: ${errorText(e)}`)
    }
  }, [api, projectName, mutateProject])

  // ── Cuts ────────────────────────────────────────────────────────────────────
  const addCut = useCallback(async (sceneId: string, opts?: { beforeCutId?: string; patch?: Partial<DirectorCut> }) => {
    if (!projectName) return null
    try {
      const created = await api.addCut(projectName, sceneId)
      const cut: DirectorCut = { ...created, ...(opts?.patch ?? {}) }
      mutateProject(p => {
        const scene = p.scenes.find(s => s.id === sceneId)
        if (!scene) return
        const cuts = [...scene.cuts].sort((a, b) => a.order - b.order).filter(c => c.id !== cut.id)
        const at = opts?.beforeCutId ? cuts.findIndex(c => c.id === opts.beforeCutId) : -1
        cuts.splice(at >= 0 ? at : cuts.length, 0, cut)
        cuts.forEach((c, i) => { c.order = i + 1 })
        scene.cuts = cuts
      })
      setActiveSceneId(sceneId)
      setActiveCutId(cut.id)
      await saveProject()
      return cut
    } catch (e) {
      setError(`Could not add cut: ${errorText(e)}`)
      return null
    }
  }, [api, projectName, mutateProject, saveProject])

  const updateCut = useCallback((sceneId: string, cutId: string, patch: Partial<DirectorCut>) => {
    mutateProject(p => {
      const cut = p.scenes.find(s => s.id === sceneId)?.cuts.find(c => c.id === cutId)
      if (cut) Object.assign(cut, patch)
    })
  }, [mutateProject])

  const deleteCut = useCallback((sceneId: string, cutId: string) => {
    mutateProject(p => {
      const scene = p.scenes.find(s => s.id === sceneId)
      if (!scene) return
      scene.cuts = scene.cuts.filter(c => c.id !== cutId).sort((a, b) => a.order - b.order)
      scene.cuts.forEach((c, i) => { c.order = i + 1 })
    })
    void saveProject()
  }, [mutateProject, saveProject])

  const moveCut = useCallback((sceneId: string, cutId: string, delta: -1 | 1) => {
    mutateProject(p => {
      const scene = p.scenes.find(s => s.id === sceneId)
      if (!scene) return
      const cuts = [...scene.cuts].sort((a, b) => a.order - b.order)
      const i = cuts.findIndex(c => c.id === cutId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= cuts.length) return
      ;[cuts[i], cuts[j]] = [cuts[j], cuts[i]]
      cuts.forEach((c, k) => { c.order = k + 1 })
      scene.cuts = cuts
    })
    void saveProject()
  }, [mutateProject, saveProject])

  // ── ComfyUI ─────────────────────────────────────────────────────────────────
  const updateComfyHost = useCallback((host: string) => {
    mutateProject(p => { p.comfyui_host = host })
    void saveProject()
  }, [mutateProject, saveProject])

  const checkComfy = useCallback(async (hostOverride?: string) => {
    const host = hostOverride ?? projectRef.current?.comfyui_host
    if (!host) return null
    let status: ComfyStatus
    try {
      status = await api.checkComfyUI(host)
    } catch (e) {
      status = { status: 'disconnected', host, error: errorText(e) }
    }
    setComfyStatus(status)
    // Generation uses the saved host, so keep one that works
    if (status.status === 'connected' && host !== projectRef.current?.comfyui_host) {
      mutateProject(p => { p.comfyui_host = host })
      void saveProject()
    }
    return status
  }, [api, mutateProject, saveProject])

  const refreshWorkflows = useCallback(async () => {
    try {
      setWorkflows(await api.listWorkflows())
    } catch (e) {
      setError(`Could not load workflows: ${errorText(e)}`)
    }
  }, [api])

  const importVideo = useCallback(async (sceneId: string, cutId: string, srcPath: string) => {
    if (!projectName) return null
    try {
      const { path } = await api.importVideo(projectName, sceneId, cutId, srcPath)
      // The backend already added it to project.json; mirror it in memory
      mutateProject(p => {
        const cut = p.scenes.find(s => s.id === sceneId)?.cuts.find(c => c.id === cutId)
        if (!cut) return
        const vids = cut.generated_videos ?? []
        if (!vids.includes(path)) vids.push(path)
        cut.generated_videos = vids
      })
      return path
    } catch (e) {
      setError(`Import failed: ${errorText(e)}`)
      return null
    }
  }, [api, projectName, mutateProject])

  const startGeneration = useCallback(async (sceneId: string, cutId: string) => {
    if (!projectName) return
    setJobs(prev => ({ ...prev, [cutId]: { status: 'pending', message: 'Saving project', cut_id: cutId } }))
    try {
      await saveProject() // backend reads the cut fields from project.json
      const job = await api.generateVideo({ project_name: projectName, scene_id: sceneId, cut_id: cutId })
      setJobs(prev => ({ ...prev, [cutId]: job }))
      if (job.id) pollJob(job.id)
    } catch (e) {
      setJobs(prev => ({ ...prev, [cutId]: { status: 'error', message: 'Failed', error: errorText(e), cut_id: cutId } }))
    }
  }, [api, projectName, saveProject, pollJob])

  const cancelGeneration = useCallback(async (cutId: string) => {
    const job = jobs[cutId]
    if (!job?.id) return
    try {
      const updated = await api.cancelJob(job.id)
      setJobs(prev => ({ ...prev, [cutId]: updated }))
    } catch (e) {
      logger.warn(`Cancel failed: ${errorText(e)}`)
    }
  }, [api, jobs])

  const dismissJob = useCallback((cutId: string) => {
    setJobs(prev => {
      const next = { ...prev }
      delete next[cutId]
      return next
    })
  }, [])

  const enhancePrompt = useCallback(async (sceneId: string, cutId: string) => {
    if (!projectName) return
    await saveProject()
    const res = await api.enhancePrompt({ project_name: projectName, scene_id: sceneId, cut_id: cutId, workflow: 'prompt_enhance' })
    if (res.enhanced_prompt) {
      updateCut(sceneId, cutId, { enhanced_prompt: res.enhanced_prompt })
      await saveProject()
    }
  }, [api, projectName, saveProject, updateCut])

  const value: StoryboardContextValue = {
    api, serverUrl, setServerUrl, connection, refreshConnection,
    projects, projectName, project, loading, saving, error, clearError: () => setError(null),
    linkProject, createAndLinkProject, unlinkProject, reloadProject, saveProject,
    workflows, jobs,
    activeSceneId, activeCutId, selectScene, selectCut,
    createScene, renameScene, deleteScene,
    addCut, updateCut, deleteCut, moveCut,
    updateComfyHost, comfyStatus, checkComfy, refreshWorkflows, importVideo,
    startGeneration, cancelGeneration, dismissJob, enhancePrompt,
  }

  return <StoryboardContext.Provider value={value}>{children}</StoryboardContext.Provider>
}

export function useStoryboard(): StoryboardContextValue {
  const ctx = useContext(StoryboardContext)
  if (!ctx) throw new Error('useStoryboard must be used within a StoryboardProvider')
  return ctx
}

/** For components that may render outside a project (returns null there). */
export function useOptionalStoryboard(): StoryboardContextValue | null {
  return useContext(StoryboardContext)
}
