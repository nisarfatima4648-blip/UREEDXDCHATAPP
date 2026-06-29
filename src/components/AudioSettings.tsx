'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { Mic, MicOff, Volume2, VolumeX, Upload, Play, Square, Headphones, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Audio Settings stored in localStorage ─────────────────────────────────

interface AudioSettingsState {
  inputDeviceId: string | null
  outputDeviceId: string | null
  inputVolume: number
  outputVolume: number
  messageNotifSound: string | null // base64 or 'default'
  callNotifSound: string | null
}

function loadSettings(): AudioSettingsState {
  try {
    const raw = localStorage.getItem('ureedxdchat_audio_settings')
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    inputDeviceId: null,
    outputDeviceId: null,
    inputVolume: 100,
    outputVolume: 100,
    messageNotifSound: null,
    callNotifSound: null,
  }
}

function saveSettings(s: AudioSettingsState) {
  localStorage.setItem('ureedxdchat_audio_settings', JSON.stringify(s))
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AudioSettings() {
  const [settings, setSettings] = useState<AudioSettingsState>(loadSettings)
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [testingMic, setTestingMic] = useState(false)
  const [testingSpeaker, setTestingSpeaker] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [enumerating, setEnumerating] = useState(false)
  const [hearMyself, setHearMyself] = useState(false)

  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micFrameRef = useRef<number>(0)
  const speakerCtxRef = useRef<AudioContext | null>(null)
  const speakerOscRef = useRef<OscillatorNode | null>(null)
  const hearMyselfCtxRef = useRef<AudioContext | null>(null)
  const hearMyselfDestRef = useRef<MediaStreamDestination | null>(null)
  const hearMyselfElRef = useRef<HTMLAudioElement | null>(null)

  const updateSetting = useCallback(<K extends keyof AudioSettingsState>(key: K, value: AudioSettingsState[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      saveSettings(next)
      return next
    })
  }, [])

  // ─── Enumerate devices ─────────────────────────────────────────────────

  const enumerateDevices = useCallback(async () => {
    setEnumerating(true)
    try {
      // Need to get a stream first to get device labels
      let tempStream: MediaStream | null = null
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        // If permission denied, enumerate with empty labels
      }

      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((d) => d.kind === 'audioinput')
      const outputs = devices.filter((d) => d.kind === 'audiooutput')

      setInputDevices(inputs)
      setOutputDevices(outputs)

      if (tempStream) {
        tempStream.getTracks().forEach((t) => t.stop())
      }

      // Auto-select first device if none selected
      const s = loadSettings()
      if (!s.inputDeviceId && inputs.length > 0) updateSetting('inputDeviceId', inputs[0].deviceId)
      if (!s.outputDeviceId && outputs.length > 0) updateSetting('outputDeviceId', outputs[0].deviceId)
    } catch (err) {
      console.error('[AudioSettings] enumerateDevices error:', err)
    }
    setEnumerating(false)
  }, [updateSetting])

  useEffect(() => {
    enumerateDevices()
  }, [enumerateDevices])

  // ─── Test Mic ───────────────────────────────────────────────────────────

  const testMic = useCallback(async () => {
    if (testingMic) {
      // Stop
      if (micFrameRef.current) cancelAnimationFrame(micFrameRef.current)
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
      micAnalyserRef.current = null
      setTestingMic(false)
      setMicLevel(0)
      return
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: settings.inputDeviceId
          ? { deviceId: { exact: settings.inputDeviceId } }
          : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      micStreamRef.current = stream

      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      micAnalyserRef.current = analyser

      setTestingMic(true)

      const detect = () => {
        if (!micAnalyserRef.current) return
        const data = new Uint8Array(micAnalyserRef.current.frequencyBinCount)
        micAnalyserRef.current.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setMicLevel(avg)
        micFrameRef.current = requestAnimationFrame(detect)
      }
      micFrameRef.current = requestAnimationFrame(detect)
    } catch (err) {
      console.error('[AudioSettings] Test mic error:', err)
    }
  }, [testingMic, settings.inputDeviceId])

  // ─── Test Speaker ───────────────────────────────────────────────────────

  const testSpeaker = useCallback(async () => {
    if (testingSpeaker) {
      // Stop
      speakerOscRef.current?.stop()
      speakerOscRef.current = null
      speakerCtxRef.current?.close().catch(() => {})
      speakerCtxRef.current = null
      setTestingSpeaker(false)
      return
    }

    try {
      const ctx = new AudioContext()
      speakerCtxRef.current = ctx
      const dest = settings.outputDeviceId
        ? ctx.createMediaStreamDestination()
        : ctx.destination

      // Set output device via setSinkId on the audio element
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      osc.connect(gain)
      gain.connect(dest)
      osc.start()
      speakerOscRef.current = osc

      // If we have a specific output device, play through an audio element
      if (settings.outputDeviceId && dest instanceof MediaStreamAudioDestinationNode) {
        const audio = new Audio()
        audio.srcObject = dest.stream
        audio.volume = settings.outputVolume / 100
        try {
          await (audio as any).setSinkId(settings.outputDeviceId)
        } catch {}
        audio.play().catch(() => {})
      }

      setTestingSpeaker(true)
    } catch (err) {
      console.error('[AudioSettings] Test speaker error:', err)
    }
  }, [testingSpeaker, settings.outputDeviceId, settings.outputVolume])

  // ─── Hear Yourself (mic → speakers loop) ──────────────────────────────

  const toggleHearMyself = useCallback(async () => {
    if (hearMyself) {
      // Stop hearing yourself
      if (hearMyselfElRef.current) {
        hearMyselfElRef.current.srcObject = null
        hearMyselfElRef.current.pause()
        hearMyselfElRef.current.remove()
        hearMyselfElRef.current = null
      }
      if (hearMyselfCtxRef.current) {
        hearMyselfCtxRef.current.close().catch(() => {})
        hearMyselfCtxRef.current = null
      }
      hearMyselfDestRef.current = null
      setHearMyself(false)
      return
    }

    try {
      // Get mic stream
      const constraints: MediaStreamConstraints = settings.inputDeviceId
        ? { audio: { deviceId: { exact: settings.inputDeviceId } } }
        : { audio: true }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // Create audio context and route mic to speakers
      const ctx = new AudioContext()
      await ctx.resume()
      hearMyselfCtxRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const dest = ctx.createMediaStreamDestination()

      // Add a small gain to prevent extreme loudness (feedback protection)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.5, ctx.currentTime)

      source.connect(gain)
      gain.connect(dest)
      hearMyselfDestRef.current = dest

      // Play through audio element (supports output device selection)
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.playsInline = true
      audio.volume = settings.outputVolume / 100
      audio.srcObject = dest.stream
      document.body.appendChild(audio)
      hearMyselfElRef.current = audio

      if (settings.outputDeviceId) {
        try { await (audio as any).setSinkId(settings.outputDeviceId) } catch {}
      }

      await audio.play()
      setHearMyself(true)
      micStreamRef.current = stream // Keep reference for cleanup
    } catch (err) {
      console.error('[AudioSettings] Hear yourself error:', err)
    }
  }, [hearMyself, settings.inputDeviceId, settings.outputDeviceId, settings.outputVolume])

  // ─── Upload custom notification sound ───────────────────────────────────

  const handleNotifSoundUpload = useCallback(
    (type: 'message' | 'call') => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const key = type === 'message' ? 'messageNotifSound' : 'callNotifSound'
          updateSetting(key, reader.result as string)
        }
        reader.readAsDataURL(file)
      }
      input.click()
    },
    [updateSetting]
  )

  const resetNotifSound = useCallback(
    (type: 'message' | 'call') => {
      const key = type === 'message' ? 'messageNotifSound' : 'callNotifSound'
      updateSetting(key, null)
    },
    [updateSetting]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (micFrameRef.current) cancelAnimationFrame(micFrameRef.current)
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      speakerOscRef.current?.stop()
      speakerCtxRef.current?.close().catch(() => {})
      if (hearMyselfElRef.current) {
        hearMyselfElRef.current.srcObject = null
        hearMyselfElRef.current.pause()
        hearMyselfElRef.current.remove()
      }
      hearMyselfCtxRef.current?.close().catch(() => {})
    }
  }, [])

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Input Device (Microphone) ─────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Input Device (Microphone)
        </Label>
        <div className="flex items-center gap-2">
          <select
            value={settings.inputDeviceId || ''}
            onChange={(e) => updateSetting('inputDeviceId', e.target.value || null)}
            className="flex-1 h-9 rounded-md border border-[#202225] bg-[#202225] text-zinc-100 text-sm px-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Default</option>
            {inputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${inputDevices.indexOf(d) + 1}`}
              </option>
            ))}
          </select>
          <Button
            variant={testingMic ? 'destructive' : 'outline'}
            size="icon"
            className="size-9"
            onClick={testMic}
          >
            {testingMic ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
        </div>

        {/* Mic level bar */}
        {testingMic && (
          <div className="h-2 rounded-full bg-zinc-700 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-75',
                micLevel > 30 ? 'bg-red-500' : micLevel > 10 ? 'bg-yellow-500' : 'bg-emerald-500'
              )}
              style={{ width: `${Math.min(micLevel, 100)}%` }}
            />
          </div>
        )}

        {/* Hear Yourself button */}
        <Button
          variant={hearMyself ? 'destructive' : 'outline'}
          size="sm"
          className={cn('w-full gap-2', hearMyself ? '' : 'border-[#202225] text-zinc-300 hover:bg-[#202225] hover:text-zinc-100')}
          onClick={toggleHearMyself}
        >
          {hearMyself ? <VolumeX className="size-3.5" /> : <Headphones className="size-3.5" />}
          {hearMyself ? 'Stop Hearing Yourself' : 'Test & Hear Yourself'}
        </Button>
        {hearMyself && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <AlertTriangle className="size-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300">
              Your microphone is playing through your speakers. If using speakers (not headphones), lower your volume to prevent feedback.
            </p>
          </div>
        )}
      </div>

      {/* ── Input Volume ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Input Volume
          </Label>
          <span className="text-xs text-zinc-500">{settings.inputVolume}%</span>
        </div>
        <Slider
          value={[settings.inputVolume]}
          onValueChange={([v]) => updateSetting('inputVolume', v)}
          max={200}
          step={1}
          className="py-2"
        />
      </div>

      <Separator className="bg-[#202225]" />

      {/* ── Output Device (Speaker) ───────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Output Device (Speaker)
        </Label>
        <div className="flex items-center gap-2">
          <select
            value={settings.outputDeviceId || ''}
            onChange={(e) => updateSetting('outputDeviceId', e.target.value || null)}
            className="flex-1 h-9 rounded-md border border-[#202225] bg-[#202225] text-zinc-100 text-sm px-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Default</option>
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${outputDevices.indexOf(d) + 1}`}
              </option>
            ))}
          </select>
          <Button
            variant={testingSpeaker ? 'destructive' : 'outline'}
            size="icon"
            className="size-9"
            onClick={testSpeaker}
          >
            {testingSpeaker ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Output Volume ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Output Volume
          </Label>
          <span className="text-xs text-zinc-500">{settings.outputVolume}%</span>
        </div>
        <Slider
          value={[settings.outputVolume]}
          onValueChange={([v]) => updateSetting('outputVolume', v)}
          max={200}
          step={1}
          className="py-2"
        />
      </div>

      <Separator className="bg-[#202225]" />

      {/* ── Message Notification Sound ────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Message Notification Sound
        </Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-[#202225] text-zinc-300 hover:bg-[#202225] hover:text-zinc-100"
            onClick={() => handleNotifSoundUpload('message')}
          >
            <Upload className="size-3" />
            {settings.messageNotifSound ? 'Change Sound' : 'Upload Custom'}
          </Button>
          {settings.messageNotifSound && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => resetNotifSound('message')}
            >
              Reset to Default
            </Button>
          )}
        </div>
        {settings.messageNotifSound && (
          <audio src={settings.messageNotifSound} preload="none" className="hidden" />
        )}
      </div>

      {/* ── Call Notification Sound ───────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Call Notification Sound
        </Label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-[#202225] text-zinc-300 hover:bg-[#202225] hover:text-zinc-100"
            onClick={() => handleNotifSoundUpload('call')}
          >
            <Upload className="size-3" />
            {settings.callNotifSound ? 'Change Sound' : 'Upload Custom'}
          </Button>
          {settings.callNotifSound && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => resetNotifSound('call')}
            >
              Reset to Default
            </Button>
          )}
        </div>
      </div>

      <Separator className="bg-[#202225]" />

      {/* ── Refresh devices button ─────────────────────────────────────── */}
      <Button
        variant="outline"
        size="sm"
        className="w-full border-[#202225] text-zinc-300 hover:bg-[#202225] hover:text-zinc-100"
        onClick={enumerateDevices}
        disabled={enumerating}
      >
        <Mic className="size-3.5 mr-1.5" />
        {enumerating ? 'Detecting Devices...' : 'Refresh Device List'}
      </Button>
    </div>
  )
}