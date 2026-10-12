# Storyboard (AI Video Director integration)

The **Storyboard** tab replaces Gen Space. It is a front end for the AI Video Director
backend, which owns the storyboard data (`project.json`) and runs generations on ComfyUI.
LTX Desktop links each LTX project to one Director project and keeps the Video Editor
timeline in step with it.

## Quick start

You need `node` 18+, `pnpm`, `uv` and `git`, plus an existing AI Video Director install
that already runs.

```sh
# 1. Get this repo on the Storyboard branch
git clone https://github.com/nick-knack-knight/LTX-Desktop-NIX-ComfyUI.git
cd LTX-Desktop-NIX-ComfyUI
git checkout claude/quirky-ptolemy-08lbbd

# 2. Install dependencies (Node packages + LTX backend venv). The script is plain bash and
#    also works on Linux. The venv is large because pyproject.toml still lists torch.
pnpm setup:dev:mac

# 3. Point at your Director install
cp director.example.json director.local.json
#    then edit director.local.json (see below)

# 4. Run everything
pnpm dev:all
```

Example `director.local.json`:

```json
{
  "dir": "~/ai-video-director",
  "python": "",
  "port": 8000,
  "projectsRoot": "~/ai-video-projects",
  "comfyuiHost": "http://127.0.0.1:8188"
}
```

- `dir`: the Director folder, either the repo root or its `backend/` folder that holds
  `main.py`.
- `python`: leave it empty if the Director has a `.venv`, `venv` or `env` folder next to
  `main.py` or one level up. Otherwise give the full path to the Python that has its
  packages installed (fastapi, uvicorn, httpx, websockets, python-multipart).
- `projectsRoot`: where your existing Director projects live. Use the same folder the
  Director normally uses; the default is `~/ai-video-projects`.
- `comfyuiHost`: used only for projects created from now on. Existing projects keep the
  host saved in their `project.json`.

When the window opens: open or create a project → **Storyboard** tab → **Link** your
Director project (or **Create & Link**) → **Video Editor** to see the cuts on the timeline.

## Setup details

**One-command launch:** copy `director.example.json` to `director.local.json` (gitignored)
and set `dir` to your AI Video Director folder. You can point it at the repo root or its
`backend/`. Then:

```sh
pnpm dev:all                     # starts the Director, waits for it, runs `pnpm dev`
pnpm dev:all -- pnpm dev:debug   # same, but with any other app command
```

- **Python:** the launcher looks for a `.venv`, `venv` or `env` next to the Director. If it
  finds none, it uses the system `python3`. Set `python` to use a specific interpreter, for
  example on NixOS.
- **Projects and ComfyUI:** `projectsRoot` and `comfyuiHost` are passed to the Director as
  `PROJECTS_ROOT` and `COMFYUI_HOST`.
- **Env vars:** `DIRECTOR_DIR`, `DIRECTOR_PYTHON`, `DIRECTOR_PORT`, `PROJECTS_ROOT` and
  `COMFYUI_HOST` override the file.
- **Port:** the Storyboard tab defaults to the port the launcher used. A URL you entered
  earlier in the tab takes precedence.
- **Shutdown:** quitting the app or pressing Ctrl+C stops the Director.
- **Already running:** if a Director is already answering on the port, the launcher reuses it
  and leaves it running.

**Manual alternative:**

1. Start the Video Director backend yourself: `uvicorn main:app --port 8000` from its
   `backend/` folder. Projects live in `$PROJECTS_ROOT` (default `~/ai-video-projects`),
   and workflows live in its `backend/workflows/`.
2. Open a project → **Storyboard** → check the Director server URL (default
   `http://127.0.0.1:8000`) → **Connect**. LTX's own backend uses a random port, so the two
   don't clash.

**Then, in the app (either way):**

1. Open a project → **Storyboard** → create a new Director project or link an existing one.
2. Click the **ComfyUI** chip in the toolbar to set or test the ComfyUI host. It's the
   address as seen from the Director backend. The same dialog lists the available
   workflows and has a **Refresh** button.

The server URL is stored per machine; the link is stored on the LTX project. The Director
already enables CORS, so packaged builds work too.

**Source images:** **Project images** lists the project's `source_images/` folder.
**Upload…** copies a file from this computer into that folder. **Browse disk** picks a file
anywhere on the Director host, by absolute path.

**Takes:** the gallery also shows renders that are on disk but missing from
`project.json`, for example ones that finished after a backend restart. **Import Video…**
copies any video file into the cut.

## How the sync works

**Storyboard → timeline** (`frontend/lib/storyboard-timeline.ts`, `frontend/views/editor/useStoryboardSync.ts`)

- Cuts are laid out end-to-end on V1 in scene order, then cut order, starting at 0s.
- A cut with a selected take becomes a video clip (plus a linked audio clip on A1). Its
  duration is the cut's `length`.
- A cut without a selected take leaves a gap of its `length`.
- The selected take is downloaded into the project assets folder
  (`<assets>/<project>/storyboard/`) so playback and ffmpeg export use local files. It is
  stored as one asset per cut, in a bin named after the scene.
- The layout runs again only when the cut order, lengths, or selected takes change. Trims,
  splits and effects on storyboard clips are kept; those clips are only moved into place.
  Clips you added yourself are never touched.
- Only the project's storyboard timeline is synced (the first timeline by default).

**Timeline → storyboard**

- If you move storyboard clips apart on V1 so the space between them is more than 0.5s wider
  than the empty cuts already there, a new empty cut is created in that position with the
  extra length. It's created about 1s after you stop dragging. Generate a take for it, and
  the take fills the gap.
- Deleting a clip from the timeline does not create a cut. To remove a shot, delete its card
  in the Storyboard.

**Editor actions**

- *Use Frame As → New Storyboard Cut*: the frame becomes the source image of a new cut,
  placed right after the clip's cut.
- *New Storyboard Cut (Audio)*: the audio file and trim offset feed a new cut.
- *Open Cut in Storyboard*: jumps to the clip's cut so you can generate another take.

## Known limits

- If you reorder clips on the timeline, the storyboard order is not updated. The next layout
  puts the clips back in storyboard order. Use the ← → buttons on the cards to reorder.
- The layout assumes nothing else is on V1 in the storyboard's time range.
- The editor uses the cut's `length` as the clip duration. It does not check the actual
  length of the video.
