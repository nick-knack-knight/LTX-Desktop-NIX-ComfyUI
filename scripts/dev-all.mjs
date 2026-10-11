#!/usr/bin/env node
// Start the AI Video Director backend, wait for it, then run LTX Desktop.
// Quitting the app (or Ctrl+C) stops the Director too.
//
//   pnpm dev:all                      # Director + `pnpm dev`
//   pnpm dev:all -- pnpm dev:debug    # Director + any other command
//
// Configure once in director.local.json at the repo root (gitignored), or with env vars:
//   {
//     "dir": "/path/to/ai-video-director",    // DIRECTOR_DIR  (repo root or its backend/ folder)
//     "python": "/path/to/python",            // DIRECTOR_PYTHON  (optional; auto-detects a venv)
//     "port": 8000,                           // DIRECTOR_PORT
//     "projectsRoot": "~/ai-video-projects",  // PROJECTS_ROOT  (optional, passed to the Director)
//     "comfyuiHost": "http://127.0.0.1:8188"  // COMFYUI_HOST  (optional, passed to the Director)
//   }
// If a Director is already answering on the port, it is reused and left running on exit.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const log = (msg) => console.log(`[dev:all] ${msg}`)
const fail = (msg) => { console.error(`[dev:all] ${msg}`); process.exit(1) }
const expandHome = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)

function loadConfig() {
  const file = path.join(repoRoot, 'director.local.json')
  let cfg = {}
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { fail(`director.local.json is not valid JSON: ${e.message}`) }
  }
  const env = process.env
  return {
    dir: expandHome(env.DIRECTOR_DIR || cfg.dir),
    python: expandHome(env.DIRECTOR_PYTHON || cfg.python),
    port: Number(env.DIRECTOR_PORT || cfg.port || 8000),
    projectsRoot: expandHome(env.PROJECTS_ROOT || cfg.projectsRoot),
    comfyuiHost: env.COMFYUI_HOST || cfg.comfyuiHost,
  }
}

/** Accept the Director repo root or its backend/ folder; return the folder holding main.py. */
function resolveBackendDir(dir) {
  if (!dir) fail('Set "dir" in director.local.json (or DIRECTOR_DIR) to your AI Video Director folder.')
  for (const candidate of [dir, path.join(dir, 'backend')]) {
    if (fs.existsSync(path.join(candidate, 'main.py'))) return candidate
  }
  fail(`No main.py found in ${dir} or ${path.join(dir, 'backend')}`)
}

/** Explicit python, else a venv next to the Director, else the system python. */
function resolvePython(explicit, backendDir) {
  if (explicit) return explicit
  const bin = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
  for (const base of [backendDir, path.dirname(backendDir)]) {
    for (const venv of ['.venv', 'venv', 'env']) {
      const p = path.join(base, venv, bin)
      if (fs.existsSync(p)) return p
    }
  }
  for (const name of isWin ? ['python', 'py'] : ['python3', 'python']) {
    if (spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0) return name
  }
  fail('No Python found for the Director. Set "python" in director.local.json.')
}

async function directorAnswering(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

async function main() {
  const sep = process.argv.indexOf('--')
  const appCmd = sep >= 0 ? process.argv.slice(sep + 1) : ['pnpm', 'dev']
  if (appCmd.length === 0) fail('Nothing to run after --')

  const cfg = loadConfig()
  let director = null
  let shuttingDown = false

  if (await directorAnswering(cfg.port)) {
    log(`Video Director already running on port ${cfg.port}; reusing it.`)
  } else {
    const backendDir = resolveBackendDir(cfg.dir)
    const python = resolvePython(cfg.python, backendDir)
    log(`Starting Video Director: ${python} -m uvicorn main:app --port ${cfg.port}  (in ${backendDir})`)
    director = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(cfg.port)], {
      cwd: backendDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        ...(cfg.projectsRoot ? { PROJECTS_ROOT: cfg.projectsRoot } : {}),
        ...(cfg.comfyuiHost ? { COMFYUI_HOST: cfg.comfyuiHost } : {}),
      },
    })
    director.on('error', (e) => fail(`Could not start the Director: ${e.message}`))

    const deadline = Date.now() + 30_000
    while (!(await directorAnswering(cfg.port))) {
      if (director.exitCode !== null) fail(`Video Director exited with code ${director.exitCode} (see its output above).`)
      if (Date.now() > deadline) { killTree(director); fail(`Video Director did not answer on port ${cfg.port} within 30s.`) }
      await new Promise((r) => setTimeout(r, 400))
    }
    log(`Video Director ready at http://127.0.0.1:${cfg.port}`)
    director.on('exit', (code) => { if (!shuttingDown) log(`Video Director stopped (code ${code}); the Storyboard tab will show it as unreachable.`) })
  }

  log(`Starting: ${appCmd.join(' ')}`)
  const app = spawn(appCmd[0], appCmd.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: isWin, // resolve pnpm.cmd etc.
    env: { ...process.env, VITE_DIRECTOR_URL: `http://127.0.0.1:${cfg.port}` },
  })

  const shutdown = (code) => {
    if (shuttingDown) return
    shuttingDown = true
    killTree(app)
    if (director) log('Stopping Video Director…')
    killTree(director)
    process.exit(code)
  }
  app.on('exit', (code) => shutdown(code ?? 0))
  app.on('error', (e) => { console.error(`[dev:all] Could not start ${appCmd[0]}: ${e.message}`); shutdown(1) })
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(130))
}

main()
