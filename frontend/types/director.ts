// Types for the AI Video Director backend (storyboard / ComfyUI orchestration).
// The Director owns project.json on disk; these mirror its shape. Unknown fields
// are preserved because the whole project is PUT back on save.

export type CropPosition = 'top' | 'center' | 'bottom' | 'left' | 'right'

export interface DirectorCut {
  id: string
  order: number
  prompt: string
  enhanced_prompt?: string | null
  source_image?: string | null
  selected_video?: string | null
  generated_videos?: string[]
  workflow: string
  seed: number
  width: number
  height: number
  length: number
  crop_position: CropPosition
  audio_file?: string | null
  audio_start?: number
  [key: string]: unknown
}

export interface DirectorScene {
  id: string
  name: string
  order?: number
  cuts: DirectorCut[]
  [key: string]: unknown
}

export interface DirectorProject {
  project_name?: string
  created_at?: string
  scenes: DirectorScene[]
  workflows: string[]
  comfyui_host?: string
  [key: string]: unknown
}

export interface DirectorProjectSummary {
  name: string            // folder name (id)
  project_name?: string   // display name
  scene_count?: number
}

export interface DirectorWorkflowInfo {
  name: string
  description?: string
  kind?: string           // 'enhance' for prompt-enhance workflows
  requires?: string[]     // 'image' | 'audio' | 'prompt'
  has_map?: boolean
}

export type DirectorJobStatus =
  | 'pending' | 'uploading' | 'queued' | 'running' | 'downloading'
  | 'done' | 'error' | 'cancelled'

export interface DirectorJob {
  id?: string
  project?: string
  cut_id: string
  status: DirectorJobStatus
  message?: string | null
  step?: number | null
  steps?: number | null
  nodes_done?: number | null
  nodes_total?: number | null
  seed?: number | null
  started_at?: number | null
  error?: string | null
  result?: { paths?: string[] } | null
}

export const ACTIVE_JOB_STATUSES: ReadonlySet<DirectorJobStatus> =
  new Set(['pending', 'uploading', 'queued', 'running', 'downloading'])
export const FINISHED_JOB_STATUSES: ReadonlySet<DirectorJobStatus> =
  new Set(['done', 'error', 'cancelled'])

export interface FsEntry {
  name: string
  path: string
  is_dir: boolean
}

export interface FsBrowseResult {
  path: string
  parent: string | null
  entries: FsEntry[]
}

export type DirectorConnection = 'unknown' | 'connected' | 'disconnected'

export interface ProjectFile {
  name: string
  path: string
  size?: number
  is_dir?: boolean
}

export interface ComfyStatus {
  status: 'connected' | 'disconnected'
  host: string
  devices?: string[]
  error?: string
}
