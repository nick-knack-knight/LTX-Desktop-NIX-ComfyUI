// Pure mapping between a Video Director storyboard and an LTX timeline.
//
// Storyboard → timeline: every cut becomes a slot laid end-to-end on the video
// track in scene/cut order. Cuts with a selected video get a clip (plus a linked
// audio clip); cuts without one leave a gap of their length.
//
// Timeline → storyboard: a gap on the video track that is wider than the empty
// cuts already accounted for in that position becomes a new storyboard cut.

import type { Asset, TimelineClip } from '../types/project'
import { DEFAULT_COLOR_CORRECTION } from '../types/project'
import type { DirectorCut, DirectorProject } from '../types/director'

export const DEFAULT_CUT_LENGTH = 5
// Gaps narrower than this are treated as slop, not as a request for a new cut
export const MIN_GAP_FOR_NEW_CUT = 0.5

export interface StoryboardSlot {
  sceneId: string
  sceneName: string
  cut: DirectorCut
  duration: number
}

export function cutDuration(cut: DirectorCut): number {
  return Number.isFinite(cut.length) && cut.length > 0 ? cut.length : DEFAULT_CUT_LENGTH
}

export function orderedSlots(project: DirectorProject | null): StoryboardSlot[] {
  if (!project) return []
  const slots: StoryboardSlot[] = []
  for (const scene of project.scenes ?? []) {
    const cuts = [...(scene.cuts ?? [])].sort((a, b) => a.order - b.order)
    for (const cut of cuts) {
      slots.push({ sceneId: scene.id, sceneName: scene.name, cut, duration: cutDuration(cut) })
    }
  }
  return slots
}

/** Key for "does the timeline need re-laying out": structure, lengths, and which videos are ready. */
export function layoutKey(slots: StoryboardSlot[], assetForCut: (cutId: string) => Asset | undefined): string {
  return JSON.stringify(slots.map(s => [s.cut.id, s.duration, assetForCut(s.cut.id)?.path ?? null]))
}

function newClipId(suffix = ''): string {
  return `clip-${Date.now()}${suffix}-${Math.random().toString(36).slice(2, 11)}`
}

function makeClip(asset: Asset, type: 'video' | 'audio', trackIndex: number, startTime: number, duration: number, cutId: string, id: string): TimelineClip {
  return {
    id,
    assetId: asset.id,
    type,
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: false,
    volume: 1,
    trackIndex,
    asset,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: 0.5 },
    transitionOut: { type: 'none', duration: 0.5 },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    opacity: 100,
    storyboardCutId: cutId,
  }
}

/**
 * Lay storyboard clips end-to-end on `videoTrack`. Clips the user didn't make are
 * untouched. Existing storyboard clips whose source video is unchanged keep their
 * internal edits (trims, splits, effects) and are only shifted into position.
 */
export function layoutStoryboardClips(
  clips: TimelineClip[],
  slots: StoryboardSlot[],
  assetForCut: (cutId: string) => Asset | undefined,
  videoTrack: number,
  audioTrack: number,
): TimelineClip[] {
  const managed = new Map<string, TimelineClip[]>()
  const out: TimelineClip[] = []
  for (const c of clips) {
    if (c.storyboardCutId) {
      const list = managed.get(c.storyboardCutId) ?? []
      list.push(c)
      managed.set(c.storyboardCutId, list)
    } else {
      out.push(c)
    }
  }

  let t = 0
  for (const slot of slots) {
    const asset = assetForCut(slot.cut.id)
    if (!asset) {
      t += slot.duration // empty cut → gap
      continue
    }
    const existing = managed.get(slot.cut.id) ?? []
    const existingVideo = existing.filter(c => c.type === 'video')
    const sameSource = existingVideo.length > 0 && existingVideo.every(c => c.asset?.path === asset.path)

    if (sameSource) {
      const spanStart = Math.min(...existing.map(c => c.startTime))
      const spanEnd = Math.max(...existing.map(c => c.startTime + c.duration))
      for (const c of existing) {
        out.push({ ...c, startTime: t + (c.startTime - spanStart), asset: c.assetId === asset.id ? asset : c.asset })
      }
      t += spanEnd - spanStart
      continue
    }

    // New or replaced video: fresh clip pair, reusing the old video clip id when present
    const videoId = existingVideo[0]?.id ?? newClipId()
    const video = makeClip(asset, 'video', videoTrack, t, slot.duration, slot.cut.id, videoId)
    if (audioTrack >= 0) {
      const audioId = newClipId('-a')
      const audio = makeClip(asset, 'audio', audioTrack, t, slot.duration, slot.cut.id, audioId)
      video.linkedClipIds = [audioId]
      audio.linkedClipIds = [videoId]
      out.push(video, audio)
    } else {
      out.push(video)
    }
    t += slot.duration
  }
  return out
}

export interface GapInsertion {
  sceneId: string
  beforeCutId: string   // the new cut goes immediately before this cut in its scene
  length: number
}

/**
 * Find gaps on the video track that aren't explained by empty cuts.
 * Walks the storyboard in order; for each cut that has clips on the track,
 * compares the space before it to the total length of the empty cuts between
 * it and the previous placed cut. Any surplus becomes a new cut.
 */
export function findUnclaimedGaps(clips: TimelineClip[], slots: StoryboardSlot[], videoTrack: number): GapInsertion[] {
  const spans = new Map<string, { start: number; end: number }>()
  for (const c of clips) {
    if (!c.storyboardCutId || c.trackIndex !== videoTrack || c.type !== 'video') continue
    const s = spans.get(c.storyboardCutId)
    const end = c.startTime + c.duration
    spans.set(c.storyboardCutId, s ? { start: Math.min(s.start, c.startTime), end: Math.max(s.end, end) } : { start: c.startTime, end })
  }

  const gaps: GapInsertion[] = []
  let cursor = 0
  let emptyLength = 0
  for (const slot of slots) {
    const span = spans.get(slot.cut.id)
    if (!span) {
      emptyLength += slot.duration
      continue
    }
    const surplus = span.start - cursor - emptyLength
    if (surplus > MIN_GAP_FOR_NEW_CUT) {
      gaps.push({ sceneId: slot.sceneId, beforeCutId: slot.cut.id, length: Math.round(surplus * 10) / 10 })
    }
    cursor = Math.max(cursor, span.end)
    emptyLength = 0
  }
  return gaps
}
