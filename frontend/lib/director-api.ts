// HTTP client for the AI Video Director backend (port of the Director's api/client.js).
// The Director runs as its own local server; its base URL is user-configurable.

import type {
  ComfyStatus, DirectorCut, DirectorJob, DirectorProject, DirectorProjectSummary, DirectorScene,
  DirectorWorkflowInfo, FsBrowseResult, ProjectFile,
} from '../types/director'

const SERVER_URL_KEY = 'ltx-director-server-url'
export const DEFAULT_DIRECTOR_SERVER_URL = 'http://127.0.0.1:8000'

export function loadDirectorServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_URL_KEY) || DEFAULT_DIRECTOR_SERVER_URL
  } catch {
    return DEFAULT_DIRECTOR_SERVER_URL
  }
}

export function saveDirectorServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_KEY, url)
  } catch {
    // Non-fatal: the URL just won't persist across restarts
  }
}

export function normalizeServerUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//.test(u)) u = `http://${u}`
  return u
}

export class DirectorApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
  }
}

/** Director folder name for a display name (mirrors the Director's createProject). */
export function directorFolderName(name: string): string {
  return name.replace(/ /g, '_').replace(/\//g, '_')
}

type Query = Record<string, string | number | boolean | null | undefined>

export class DirectorApi {
  readonly baseUrl: string

  constructor(serverUrl: string) {
    this.baseUrl = normalizeServerUrl(serverUrl)
  }

  private url(path: string, query?: Query): string {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    }
    const q = qs.toString()
    return `${this.baseUrl}/api${path}${q ? `?${q}` : ''}`
  }

  private async request<T>(method: string, path: string, opts: { query?: Query; json?: unknown; body?: BodyInit } = {}): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers: opts.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      })
    } catch (e) {
      throw new DirectorApiError(`Cannot reach Video Director at ${this.baseUrl} (${e instanceof Error ? e.message : String(e)})`, null)
    }
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`
      try {
        const body: unknown = await res.json()
        if (body && typeof body === 'object' && 'detail' in body) {
          const d = (body as { detail: unknown }).detail
          detail = typeof d === 'string' ? d : JSON.stringify(d)
        }
      } catch {
        // keep status text
      }
      throw new DirectorApiError(detail, res.status)
    }
    return (await res.json()) as T
  }

  private p(name: string): string {
    return encodeURIComponent(name)
  }

  // ── Projects ────────────────────────────────────────────────────────────────
  listProjects = () => this.request<DirectorProjectSummary[]>('GET', '/projects')
  createProject = (name: string) => this.request<DirectorProject>('POST', '/projects', { json: { name } })
  getProject = (name: string) => this.request<DirectorProject>('GET', `/projects/${this.p(name)}`)
  updateProject = (name: string, data: DirectorProject) => this.request<unknown>('PUT', `/projects/${this.p(name)}`, { json: data })

  // ── Scenes / cuts ───────────────────────────────────────────────────────────
  createScene = (project: string, name: string) =>
    this.request<DirectorScene>('POST', `/projects/${this.p(project)}/scenes`, { json: { name } })
  deleteScene = (project: string, sceneId: string) =>
    this.request<unknown>('DELETE', `/projects/${this.p(project)}/scenes/${this.p(sceneId)}`)
  addCut = (project: string, sceneId: string) =>
    this.request<DirectorCut>('POST', `/projects/${this.p(project)}/scenes/${this.p(sceneId)}/cuts`)

  // ── Files ───────────────────────────────────────────────────────────────────
  fileUrl = (project: string, path: string) =>
    this.url(`/projects/${this.p(project)}/file`, { path })
  fsBrowse = (path: string | null) => this.request<FsBrowseResult>('GET', '/fs/browse', { query: { path } })
  /** Images in the project's source_images/ folder (paths are project-relative) */
  browseImages = (project: string, subpath = '') =>
    this.request<ProjectFile[]>('GET', `/projects/${this.p(project)}/images`, { query: { subpath } })
  /** Video files on disk in a cut's folder, including renders missing from project.json */
  browseVideos = (project: string, sceneId: string, cutId: string) =>
    this.request<ProjectFile[]>('GET', `/projects/${this.p(project)}/videos`, { query: { scene_id: sceneId, cut_id: cutId } })
  uploadImage = (project: string, sceneId: string, file: Blob, filename: string) => {
    const fd = new FormData()
    fd.append('file', file, filename)
    return this.request<{ path: string }>('POST', `/projects/${this.p(project)}/upload-image`, { query: { scene_id: sceneId }, body: fd })
  }
  /** Copy a video from the Director host's disk into the cut's folder (adds it to generated_videos) */
  importVideo = (project: string, sceneId: string, cutId: string, srcPath: string) =>
    this.request<{ path: string }>('POST', `/projects/${this.p(project)}/import-video`, {
      query: { scene_id: sceneId, cut_id: cutId }, json: { src_path: srcPath },
    })

  // ── ComfyUI / jobs ──────────────────────────────────────────────────────────
  // Always 200; the payload's status says whether ComfyUI answered
  checkComfyUI = (host: string) => this.request<ComfyStatus>('GET', '/comfyui/status', { query: { comfyui_host: host } })
  enhancePrompt = (data: { project_name: string; scene_id: string; cut_id: string; workflow: string }) =>
    this.request<{ enhanced_prompt?: string | null }>('POST', '/comfyui/enhance-prompt', { json: data })
  generateVideo = (data: { project_name: string; scene_id: string; cut_id: string }) =>
    this.request<DirectorJob>('POST', '/comfyui/generate', { json: data })
  listWorkflows = () => this.request<DirectorWorkflowInfo[]>('GET', '/workflows')
  getJob = (id: string) => this.request<DirectorJob>('GET', `/jobs/${this.p(id)}`)
  listJobs = (project: string, activeOnly = true) =>
    this.request<DirectorJob[]>('GET', '/jobs', { query: { project, active_only: activeOnly } })
  cancelJob = (id: string) => this.request<DirectorJob>('POST', `/jobs/${this.p(id)}/cancel`)
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e ?? 'Request failed')
}

export function fileBaseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
