// Keeps the storyboard timeline in step with the linked Video Director project.
//
//  • Each cut's selected video is copied into the project assets folder (so playback
//    and ffmpeg export use real local files) and mirrored as one asset per cut.
//  • Whenever the storyboard's order, lengths, or ready videos change, storyboard clips
//    are re-laid end-to-end on V1 (+ linked audio on A1). User clips are left alone.
//  • When the user opens up a gap between storyboard clips, a new empty cut is created
//    in that position so the storyboard gains a card for the missing shot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, Project, TimelineClip, Track } from '../../types/project'
import type { DirectorCut } from '../../types/director'
import { useOptionalStoryboard } from '../../contexts/StoryboardContext'
import { errorText, fileBaseName } from '../../lib/director-api'
import { findUnclaimedGaps, layoutKey, layoutStoryboardClips, orderedSlots, type StoryboardSlot } from '../../lib/storyboard-timeline'
import { copyToAssetFolder } from '../../lib/asset-copy'
import { fileUrlToPath } from '../../lib/url-to-path'
import { logger } from '../../lib/logger'

const GAP_DEBOUNCE_MS = 1200

function layoutStorageKey(timelineId: string): string {
  return `ltx-storyboard-layout:${timelineId}`
}

function readStoredLayoutKey(timelineId: string): string | null {
  try { return localStorage.getItem(layoutStorageKey(timelineId)) } catch { return null }
}

function writeStoredLayoutKey(timelineId: string, key: string): void {
  try { localStorage.setItem(layoutStorageKey(timelineId), key) } catch { /* layout just re-runs next load */ }
}

interface UseStoryboardSyncParams {
  clips: TimelineClip[]
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  tracks: Track[]
  assets: Asset[]
  currentProject: Project | null
  activeTimelineId: string
  addAsset: (projectId: string, data: Omit<Asset, 'id' | 'createdAt'>) => Asset
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  pushUndo: () => void
  /** True while the user is mid-drag/resize; sync waits until they let go */
  isInteracting: boolean
}

export function useStoryboardSync({
  clips, setClips, tracks, assets, currentProject, activeTimelineId,
  addAsset, updateAsset, pushUndo, isInteracting,
}: UseStoryboardSyncParams) {
  const sb = useOptionalStoryboard()
  const project = sb?.project ?? null
  const projectId = currentProject?.id ?? null
  const storyboardTimelineId = currentProject?.storyboardTimelineId ?? currentProject?.timelines?.[0]?.id ?? null
  const enabled = !!sb && !!project && !!currentProject?.directorProject
    && sb.projectName === currentProject.directorProject
    && !!activeTimelineId && activeTimelineId === storyboardTimelineId

  const slots = useMemo(() => orderedSlots(project), [project])

  const videoTrack = tracks.findIndex(t => t.kind === 'video' && t.type !== 'subtitle')
  const audioTrack = tracks.findIndex(t => t.kind === 'audio')

  // Assets created/updated here, ahead of the project context catching up
  const pendingAssetsRef = useRef(new Map<string, Asset>())
  const [assetVersion, setAssetVersion] = useState(0)

  const assetForCut = useCallback((cut: DirectorCut): Asset | undefined => {
    const pending = pendingAssetsRef.current.get(cut.id)
    const live = assets.find(a => a.storyboardCutId === cut.id)
    const asset = pending && (!live || live.storyboardSource !== pending.storyboardSource) ? pending : live
    // Only "ready" when it mirrors the cut's current selection
    return asset && cut.selected_video && asset.storyboardSource === cut.selected_video ? asset : undefined
    // assetVersion: pending assets live in a ref, so bump identity when one lands
  }, [assets, assetVersion])

  const slotAsset = useCallback((cutId: string) => {
    const slot = slots.find(s => s.cut.id === cutId)
    return slot ? assetForCut(slot.cut) : undefined
  }, [slots, assetForCut])

  // ── 1) Mirror each cut's selected video as a local asset ─────────────────────
  const inFlightRef = useRef(new Set<string>())
  useEffect(() => {
    if (!enabled || !sb || !projectId || !sb.projectName) return
    const directorName = sb.projectName
    for (const slot of slots) {
      const video = slot.cut.selected_video
      if (!video || assetForCut(slot.cut)) continue
      const flightKey = `${slot.cut.id}|${video}`
      if (inFlightRef.current.has(flightKey)) continue
      inFlightRef.current.add(flightKey)
      void mirrorCutVideo(slot, video, directorName).finally(() => {
        inFlightRef.current.delete(flightKey)
        setAssetVersion(v => v + 1)
      })
    }

    async function mirrorCutVideo(slot: StoryboardSlot, video: string, directorName: string) {
      if (!sb || !projectId) return
      const remoteUrl = sb.api.fileUrl(directorName, video)
      let path = remoteUrl
      let url = remoteUrl
      try {
        const res = await window.electronAPI.downloadToProjectAssets(remoteUrl, projectId, `${slot.cut.id}_${fileBaseName(video)}`)
        if (res.success && res.path && res.url) {
          path = res.path
          url = res.url
        } else {
          logger.warn(`Storyboard: could not copy ${video} locally (${res.error}); streaming from the Director instead — export will skip it`)
        }
      } catch (e) {
        logger.warn(`Storyboard: download failed for ${video}: ${errorText(e)}`)
      }
      const cut = slot.cut
      const fields = {
        path,
        url,
        prompt: cut.enhanced_prompt ?? cut.prompt,
        resolution: `${cut.width}x${cut.height}`,
        duration: slot.duration,
        bin: slot.sceneName,
        storyboardCutId: cut.id,
        storyboardSource: video,
        takes: undefined,
        activeTakeIndex: undefined,
      }
      const existing = pendingAssetsRef.current.get(cut.id) ?? assets.find(a => a.storyboardCutId === cut.id)
      if (existing) {
        updateAsset(projectId, existing.id, fields)
        pendingAssetsRef.current.set(cut.id, { ...existing, ...fields })
      } else {
        const created = addAsset(projectId, { type: 'video', ...fields })
        pendingAssetsRef.current.set(cut.id, created)
      }
    }
  }, [enabled, slots, assetForCut, projectId])

  // ── 2) Storyboard → timeline layout ─────────────────────────────────────────
  const currentLayoutKey = useMemo(() => layoutKey(slots, slotAsset), [slots, slotAsset])
  // Last layout applied to this timeline (persisted so edits survive restarts). Read
  // synchronously: an effect-based read would let the first render re-layout.
  const laidOutRef = useRef<{ timelineId: string; key: string | null } | null>(null)
  if (laidOutRef.current?.timelineId !== activeTimelineId) {
    laidOutRef.current = { timelineId: activeTimelineId, key: readStoredLayoutKey(activeTimelineId) }
  }
  const layoutPending = laidOutRef.current.key !== currentLayoutKey

  useEffect(() => {
    if (!enabled || isInteracting || videoTrack < 0 || !layoutPending) return
    pushUndo()
    setClips(prev => layoutStoryboardClips(prev, slots, slotAsset, videoTrack, audioTrack))
    writeStoredLayoutKey(activeTimelineId, currentLayoutKey)
    laidOutRef.current = { timelineId: activeTimelineId, key: currentLayoutKey }
  }, [enabled, isInteracting, currentLayoutKey, layoutPending])

  // ── 3) Timeline gaps → new storyboard cuts ──────────────────────────────────
  const creatingCutsRef = useRef(false)
  useEffect(() => {
    if (!enabled || !sb || isInteracting || videoTrack < 0) return
    if (layoutPending) return // clips are stale until the pending layout lands
    const timer = setTimeout(() => {
      if (creatingCutsRef.current) return
      const gaps = findUnclaimedGaps(clips, slots, videoTrack)
      if (gaps.length === 0) return
      creatingCutsRef.current = true
      void (async () => {
        try {
          for (const gap of gaps) {
            logger.info(`Storyboard: timeline gap of ${gap.length}s → new cut before ${gap.beforeCutId}`)
            await sb.addCut(gap.sceneId, { beforeCutId: gap.beforeCutId, patch: { length: gap.length } })
          }
        } finally {
          creatingCutsRef.current = false
        }
      })()
    }, GAP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [clips, enabled, isInteracting, slots, layoutPending])

  // ── Editor → storyboard actions ─────────────────────────────────────────────

  /** Where a new cut for `clip` should go: right after the clip's own cut, else at the end. */
  const insertionPointFor = useCallback((clip: TimelineClip | null): { sceneId: string; beforeCutId?: string } | null => {
    if (!project || project.scenes.length === 0) return null
    if (clip?.storyboardCutId) {
      const i = slots.findIndex(s => s.cut.id === clip.storyboardCutId)
      if (i >= 0) {
        const next = slots[i + 1]
        return next && next.sceneId === slots[i].sceneId
          ? { sceneId: slots[i].sceneId, beforeCutId: next.cut.id }
          : { sceneId: slots[i].sceneId }
      }
    }
    const sceneId = sb?.activeSceneId && project.scenes.some(s => s.id === sb.activeSceneId)
      ? sb.activeSceneId
      : project.scenes[project.scenes.length - 1].id
    return { sceneId }
  }, [project, slots, sb?.activeSceneId])

  /** Create a storyboard cut from timeline media (frame → source image, audio → audio file). */
  const createCutFromClip = useCallback(async (clip: TimelineClip, patch: Partial<DirectorCut>): Promise<boolean> => {
    if (!sb || !project) return false
    const at = insertionPointFor(clip)
    if (!at) return false
    const cut = await sb.addCut(at.sceneId, { beforeCutId: at.beforeCutId, patch })
    return !!cut
  }, [sb, project, insertionPointFor])

  /** Copy a file:// frame into the project assets folder so its path stays valid for the Director. */
  const persistFrame = useCallback(async (fileUrl: string): Promise<string | null> => {
    const p = fileUrlToPath(fileUrl)
    if (!p || !projectId) return p
    const copied = await copyToAssetFolder(p, projectId)
    return copied?.path ?? p
  }, [projectId])

  const revealCut = useCallback((cutId: string): boolean => {
    if (!sb) return false
    const slot = slots.find(s => s.cut.id === cutId)
    if (!slot) return false
    sb.selectCut(slot.sceneId, cutId)
    return true
  }, [sb, slots])

  return {
    storyboardLinked: !!sb && !!project,
    storyboardEnabled: enabled,
    createCutFromClip,
    persistFrame,
    revealCut,
  }
}
