import { useState } from 'react'
import { FileJson, RefreshCw, Wifi, X } from 'lucide-react'
import { useStoryboard } from '../../contexts/StoryboardContext'

/** Port of the Director's project settings: ComfyUI connection, workflows, project info. */
export function StoryboardSettingsModal({ onClose }: { onClose: () => void }) {
  const { project, updateComfyHost, comfyStatus, checkComfy, workflows, refreshWorkflows } = useStoryboard()
  const [host, setHost] = useState(project?.comfyui_host ?? 'http://127.0.0.1:8188')
  const [testing, setTesting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  if (!project) return null

  const test = async () => {
    setTesting(true)
    await checkComfy(host)
    setTesting(false)
  }

  const statusLine = comfyStatus?.status === 'connected'
    ? <span className="text-green-400">✓ Connected{comfyStatus.devices?.length ? ` · ${comfyStatus.devices.join(', ')}` : ''}</span>
    : comfyStatus?.status === 'disconnected'
      ? <span className="text-red-400">✗ Disconnected{comfyStatus.error ? ` · ${comfyStatus.error}` : ''}</span>
      : <span className="text-zinc-500">? Unknown — press Test</span>

  const totalCuts = project.scenes.reduce((a, s) => a + s.cuts.length, 0)
  const sectionTitle = 'text-[11px] uppercase tracking-wider text-zinc-500 mb-2'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-zinc-800 text-sm font-semibold text-white">
          <span>Storyboard Settings — {project.project_name}</span>
          <button className="ml-auto p-1 rounded hover:bg-zinc-800 text-zinc-400" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
          <section>
            <h3 className={sectionTitle}>ComfyUI Connection</h3>
            <div className="flex gap-2">
              <input className="flex-1 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                value={host} onChange={e => setHost(e.target.value)} placeholder="http://127.0.0.1:8188" />
              <button className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-white" onClick={() => updateComfyHost(host)}>Save</button>
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-white disabled:opacity-50"
                onClick={() => void test()} disabled={testing}>
                <Wifi className="h-3.5 w-3.5" /> {testing ? 'Testing…' : 'Test'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">
              The address as seen from the Video Director backend. Same machine: http://127.0.0.1:8188.
              Through a tunnel: the tunnel URL (https:// tunnels use wss:// for progress automatically).
            </p>
            <div className="text-xs mt-2">{statusLine}</div>
          </section>

          <section>
            <h3 className={sectionTitle}>Workflows</h3>
            <p className="text-[11px] text-zinc-500 mb-2">
              Loaded from the Director's <code className="text-zinc-300">backend/workflows/</code>. Add a workflow exported with
              ComfyUI's <b>Export (API)</b>, plus an optional <code className="text-zinc-300">name.map.json</code> describing which
              node receives each cut field, then press Refresh.
            </p>
            <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800">
              {workflows.map(w => (
                <div key={w.name} className="px-3 py-2" title={w.description}>
                  <div className="flex items-center gap-1.5 text-xs text-white"><FileJson className="h-3.5 w-3.5 text-zinc-500" /> {w.name}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    {w.kind ?? 'video'} · {w.has_map ? 'mapped' : 'auto-detect'} · needs {(w.requires ?? []).join(', ') || 'nothing'}
                  </div>
                  {w.description && <div className="text-[10px] text-zinc-400 mt-0.5">{w.description}</div>}
                </div>
              ))}
              {workflows.length === 0 && <div className="px-3 py-3 text-xs text-zinc-500">No workflows found in backend/workflows/.</div>}
            </div>
            <button className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs text-white disabled:opacity-50"
              disabled={refreshing} onClick={async () => { setRefreshing(true); await refreshWorkflows(); setRefreshing(false) }}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </section>

          <section>
            <h3 className={sectionTitle}>Project Info</h3>
            <div className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
              <span className="text-zinc-500">Created</span><span className="text-zinc-200">{project.created_at ? new Date(/Z|[+-]\d\d:\d\d$/.test(project.created_at) ? project.created_at : `${project.created_at}Z`).toLocaleString() : '—'}</span>
              <span className="text-zinc-500">Scenes</span><span className="text-zinc-200">{project.scenes.length}</span>
              <span className="text-zinc-500">Total cuts</span><span className="text-zinc-200">{totalCuts}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
