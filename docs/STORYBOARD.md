# Storyboard (AI Video Director integration)

The **Storyboard** tab replaces Gen Space. It is a front end for the AI Video Director
backend, which owns the storyboard data (`project.json`) and runs generations on ComfyUI.
LTX Desktop links each LTX project to one Director project and keeps the Video Editor
timeline in step with it.

## Setup

1. Start the Video Director backend (it is a separate server).
2. Open a project → **Storyboard** → enter the Director server URL (default
   `http://127.0.0.1:8001`) → **Connect**.
3. Create a new Director project or link an existing one.

The server URL is stored per machine; the link is stored on the LTX project.

**Packaged builds:** the renderer loads from `file://`, so the Director backend must allow
CORS (dev builds run with `webSecurity` off and don't need it). In the Director's FastAPI app:

```py
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```

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
