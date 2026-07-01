'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { answerCall, declineCall, hangUpCall, sendDMCallSignal, onSocketEvent, offSocketEvent } from '@/lib/socket'
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Headphones,
  AudioWaveform,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Ringtone (Web Audio API) ──────────────────────────────────────────────

let ringtoneCtx: AudioContext | null = null
let ringtoneInterval: ReturnType<typeof setInterval> | null = null
let ringtonePlaying = false
let activeOscillators: OscillatorNode[] = []
let activeGain: GainNode | null = null
// Safety auto-stop: never let a ringtone play longer than this (guards against
// lost signaling events leaving the ringtone running forever).
let ringtoneSafetyTimeout: ReturnType<typeof setTimeout> | null = null
const RINGTONE_MAX_DURATION_MS = 45000

function stopRingtone() {
  // Idempotent + synchronous: stop everything immediately.
  ringtonePlaying = false
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval)
    ringtoneInterval = null
  }
  if (ringtoneSafetyTimeout) {
    clearTimeout(ringtoneSafetyTimeout)
    ringtoneSafetyTimeout = null
  }
  // Immediately stop & disconnect all oscillators
  activeOscillators.forEach(o => {
    try { o.stop() } catch {}
    try { o.disconnect() } catch {}
  })
  activeOscillators = []
  if (activeGain) {
    try { activeGain.disconnect() } catch {}
    activeGain = null
  }
  // Synchronously close the AudioContext (close() returns a promise but audio
  // stops immediately). We capture the local ref so the async .then never
  // references a stale module variable.
  const ctx = ringtoneCtx
  ringtoneCtx = null
  if (ctx) {
    try {
      // Suspend first for an immediate halt, then close to free resources.
      ctx.suspend().catch(() => {})
      ctx.close().catch(() => {})
    } catch {}
  }
}

function playRingtone() {
  // If already playing, do nothing (idempotent)
  if (ringtonePlaying) return
  // Clean up any previous state first
  stopRingtone()
  ringtonePlaying = true

  try {
    ringtoneCtx = new AudioContext()
    // Resume immediately in case it starts suspended (autoplay policy)
    if (ringtoneCtx.state === 'suspended') {
      ringtoneCtx.resume().catch(() => {})
    }

    const playTone = () => {
      if (!ringtoneCtx || !ringtonePlaying) return
      if (ringtoneCtx.state === 'suspended') ringtoneCtx.resume().catch(() => {})

      // Stop any previously playing oscillators
      activeOscillators.forEach(o => { try { o.stop() } catch {} })
      activeOscillators = []
      if (activeGain) { try { activeGain.disconnect() } catch {} }

      const osc1 = ringtoneCtx.createOscillator()
      const osc2 = ringtoneCtx.createOscillator()
      const gain = ringtoneCtx.createGain()
      activeOscillators = [osc1, osc2]
      activeGain = gain

      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(440, ringtoneCtx.currentTime)
      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(523.25, ringtoneCtx.currentTime)

      gain.gain.setValueAtTime(0, ringtoneCtx.currentTime)
      gain.gain.linearRampToValueAtTime(0.12, ringtoneCtx.currentTime + 0.05)
      gain.gain.linearRampToValueAtTime(0, ringtoneCtx.currentTime + 0.8)

      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ringtoneCtx.destination)

      osc1.start(ringtoneCtx.currentTime)
      osc2.start(ringtoneCtx.currentTime)
      osc1.stop(ringtoneCtx.currentTime + 0.8)
      osc2.stop(ringtoneCtx.currentTime + 0.8)
    }

    playTone()
    ringtoneInterval = setInterval(playTone, 2000)

    // Safety: force-stop after max duration (prevents infinite ringing if a
    // connected/ended/declined event is lost in transit)
    ringtoneSafetyTimeout = setTimeout(() => {
      stopRingtone()
    }, RINGTONE_MAX_DURATION_MS)
  } catch {
    // Audio not available
    ringtonePlaying = false
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/[\s_]+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function formatDuration(startDate?: string): string {
  if (!startDate) return '0:00'
  const diff = Math.floor((Date.now() - new Date(startDate).getTime()) / 1000)
  const mins = Math.floor(diff / 60)
  const secs = diff % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

// ─── Ringing Animation ─────────────────────────────────────────────────────

function RingingAnimation() {
  return (
    <div className="relative flex items-center justify-center">
      <div className="absolute w-32 h-32 rounded-full border-2 border-green-400/40 animate-ping" />
      <div className="absolute w-28 h-28 rounded-full border-2 border-green-400/30 animate-ping [animation-delay:500ms]" />
      <div className="absolute w-24 h-24 rounded-full border border-green-400/20 animate-pulse" />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// WebRTC Manager — singleton for DM call audio
// ═══════════════════════════════════════════════════════════════════════════

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    // STUN servers for candidate gathering
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Free public TURN servers (OpenRelay) — relay traffic when direct P2P fails.
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all',
}

// Audio constraints — uses browser-native DSP (echo cancellation, noise suppression).
// The track from getUserMedia is a NATIVE track that always works with WebRTC.
const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
}

// Module-level WebRTC state (singleton — only one DM call at a time)
let dmLocalStream: MediaStream | null = null
let dmPeerConnection: RTCPeerConnection | null = null
let dmRemoteAudioEl: HTMLAudioElement | null = null
let dmIsMuted = false
let dmIsDeafened = false
let dmAudioCtx: AudioContext | null = null
// Track signaling state to prevent race conditions
let dmSignalingState: 'idle' | 'creating-offer' | 'waiting-answer' | 'handling-offer' | 'connected' = 'idle'

function cleanupDMCall() {
  // Close peer connection
  if (dmPeerConnection) {
    try { dmPeerConnection.close() } catch { /* ok */ }
    dmPeerConnection = null
  }

  // Stop local stream tracks (native getUserMedia stream)
  if (dmLocalStream) {
    dmLocalStream.getTracks().forEach((t) => t.stop())
    dmLocalStream = null
  }
  // Clear any in-flight capture promise so the next call starts fresh
  dmLocalStreamPromise = null

  // Remove remote audio element
  if (dmRemoteAudioEl) {
    dmRemoteAudioEl.srcObject = null
    dmRemoteAudioEl.pause()
    dmRemoteAudioEl.remove()
    dmRemoteAudioEl = null
  }

  // Close audio context (for speaking detection — separate from noise suppressor's)
  if (dmAudioCtx) {
    try { dmAudioCtx.close() } catch { /* ok */ }
    dmAudioCtx = null
  }

  dmIsMuted = false
  dmIsDeafened = false
  dmSignalingState = 'idle'
}

// Pending promise so concurrent callers share a single getUserMedia() call
let dmLocalStreamPromise: Promise<MediaStream | null> | null = null

async function setupLocalStream(): Promise<MediaStream | null> {
  // Already captured
  if (dmLocalStream) return dmLocalStream
  // A capture is already in flight — piggyback on it instead of calling
  // getUserMedia again (which would leak the first stream's tracks).
  if (dmLocalStreamPromise) return dmLocalStreamPromise

  dmLocalStreamPromise = (async () => {
    try {
      // Use browser-native getUserMedia with noise suppression constraints.
      // The track from getUserMedia is a NATIVE track that always works with
      // WebRTC — no AudioContext suspension issues, no silence bugs.
      const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS)
      dmLocalStream = stream
      return stream
    } catch (err) {
      return null
    } finally {
      dmLocalStreamPromise = null
    }
  })()
  return dmLocalStreamPromise
}

function setDMCallMuted(muted: boolean) {
  dmIsMuted = muted
  // Toggle track.enabled on the native getUserMedia stream
  if (dmLocalStream) {
    dmLocalStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }
}

function setDMCallDeafened(deafened: boolean) {
  dmIsDeafened = deafened
  if (dmRemoteAudioEl) {
    dmRemoteAudioEl.volume = deafened ? 0 : 1
    dmRemoteAudioEl.muted = deafened
  }
}

// ─── Helper: set up remote audio element and play ────────────────────────
function ensureRemoteAudioAndPlay(stream: MediaStream) {
  if (!dmRemoteAudioEl) {
    dmRemoteAudioEl = document.createElement('audio')
    dmRemoteAudioEl.autoplay = true
    dmRemoteAudioEl.playsInline = true
    dmRemoteAudioEl.volume = dmIsDeafened ? 0 : 1
    dmRemoteAudioEl.muted = dmIsDeafened
    document.body.appendChild(dmRemoteAudioEl)
  }
  dmRemoteAudioEl.srcObject = stream

  // Retry play() up to 5 times — browser autoplay policy may block the first
  // attempt, especially when ontrack fires asynchronously after the user gesture.
  const tryPlay = (attempt: number) => {
    if (!dmRemoteAudioEl) return
    // Make sure the element isn't muted (unless deafened) so audio is audible
    if (!dmIsDeafened) {
      dmRemoteAudioEl.muted = false
      dmRemoteAudioEl.volume = 1
    }
    dmRemoteAudioEl.play().then(() => {
    }).catch(async (e) => {
      if (attempt < 5) {
        await new Promise(r => setTimeout(r, 250))
        tryPlay(attempt + 1)
      } else {
        // Last resort: force unmute + volume + retry
        if (dmRemoteAudioEl) {
          dmRemoteAudioEl.muted = false
          dmRemoteAudioEl.volume = 1
          dmRemoteAudioEl.play().catch(() => {})
        }
      }
    })
  }
  tryPlay(0)
}

// ─── Caller: Create Offer ─────────────────────────────────────────────────
async function createOffer(dmConversationId: string, targetUserId: string): Promise<void> {
  const stream = dmLocalStream
  if (!stream) {
    return
  }

  // Guard against double-calling
  if (dmPeerConnection) {
    return
  }
  dmSignalingState = 'creating-offer'

  try {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    dmPeerConnection = pc

    // Add local audio tracks
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream)
    })

    // Handle remote audio
    pc.ontrack = (event) => {
      // Use event.streams[0] if available, otherwise create a new stream from the track
      const remoteStream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track])
      ensureRemoteAudioAndPlay(remoteStream)
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendDMCallSignal(dmConversationId, targetUserId, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        })
      }
    }

    // Handle connection state
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        dmSignalingState = 'connected'
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        dmSignalingState = 'idle'
      }
    }

    // Create and send offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    })

    await pc.setLocalDescription(offer)
    dmSignalingState = 'waiting-answer'


    sendDMCallSignal(dmConversationId, targetUserId, {
      type: 'offer',
      sdp: pc.localDescription?.sdp,
    })
  } catch (err) {
    dmSignalingState = 'idle'
    if (dmPeerConnection) {
      try { dmPeerConnection.close() } catch { /* ok */ }
      dmPeerConnection = null
    }
  }
}

// ─── Caller: Handle Answer ─────────────────────────────────────────────────
async function handleAnswer(data: any): Promise<void> {
  const pc = dmPeerConnection
  if (!pc) return

  // Guard: only set remote description if we're in waiting-answer state
  if (dmSignalingState !== 'waiting-answer') {
    return
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.signal.sdp }))
    dmSignalingState = 'connected'
  } catch (err) {
  }
}

// ─── Callee: Handle Incoming Offer ────────────────────────────────────────
async function handleIncomingOffer(dmConversationId: string, fromUserId: string, signal: any): Promise<void> {
  // Guard: don't handle if we already have a peer connection or are signaling
  if (dmPeerConnection) {
    return
  }
  if (dmSignalingState !== 'idle') {
    return
  }

  const stream = dmLocalStream
  if (!stream) {
    return
  }

  dmSignalingState = 'handling-offer'

  try {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    dmPeerConnection = pc

    // Add local tracks
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream)
    })

    // Handle remote audio
    pc.ontrack = (event) => {
      const remoteStream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track])
      ensureRemoteAudioAndPlay(remoteStream)
    }

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendDMCallSignal(dmConversationId, fromUserId, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        })
      }
    }

    // Handle connection state
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        dmSignalingState = 'connected'
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        dmSignalingState = 'idle'
      }
    }

    // Set remote description (the offer)
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }))

    // Create and send answer
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)


    sendDMCallSignal(dmConversationId, fromUserId, {
      type: 'answer',
      sdp: pc.localDescription?.sdp,
    })

    dmSignalingState = 'connected'
  } catch (err) {
    dmSignalingState = 'idle'
    if (dmPeerConnection) {
      try { dmPeerConnection.close() } catch { /* ok */ }
      dmPeerConnection = null
    }
  }
}

// ─── Handle ICE Candidate ─────────────────────────────────────────────────
async function handleICECandidate(signal: any): Promise<void> {
  const pc = dmPeerConnection
  if (!pc || !signal.candidate) return

  try {
    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
  } catch {
    // ICE candidate may arrive after peer is closed — ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Incoming Call Overlay
// ═══════════════════════════════════════════════════════════════════════════

function IncomingCallOverlay() {
  const incomingCall = useAppStore((s) => s.incomingCall)
  const setIncomingCall = useAppStore((s) => s.setIncomingCall)
  const setActiveCall = useAppStore((s) => s.setActiveCall)
  const setCallMuted = useAppStore((s) => s.setCallMuted)
  const setCallDeafened = useAppStore((s) => s.setCallDeafened)
  const countdownRef = useRef(30)
  const [countdown, setCountdown] = useState(30)

  useEffect(() => {
    if (incomingCall) playRingtone()
    return () => stopRingtone()
  }, [incomingCall])

  useEffect(() => {
    if (!incomingCall) return
    countdownRef.current = 30
    const timer = setInterval(() => {
      countdownRef.current -= 1
      if (countdownRef.current <= 0) {
        declineCall(incomingCall.dmConversationId)
        setIncomingCall(null)
        return
      }
      setCountdown(countdownRef.current)
    }, 1000)
    return () => clearInterval(timer)
  }, [incomingCall, setIncomingCall])

  const handleAccept = useCallback(async () => {
    if (!incomingCall) return
    stopRingtone()

    // Set up local stream BEFORE answering so it's ready for WebRTC
    await setupLocalStream()
    setDMCallMuted(false)

    // IMPORTANT: Set activeCall with isCaller: false so we don't create an offer
    setActiveCall({
      dmConversationId: incomingCall.dmConversationId,
      callerId: incomingCall.callerId,
      callerName: incomingCall.callerName,
      callerAvatar: incomingCall.callerAvatar,
      status: 'connected',
      startedAt: new Date().toISOString(),
      isCaller: false,
    })
    setCallMuted(false)
    setCallDeafened(false)
    setIncomingCall(null)

    // Now tell server we answered (server will emit dm:call:connected to both)
    answerCall(incomingCall.dmConversationId)
  }, [incomingCall, setIncomingCall, setActiveCall, setCallMuted, setCallDeafened])

  const handleDecline = useCallback(() => {
    if (!incomingCall) return
    stopRingtone()
    declineCall(incomingCall.dmConversationId)
    setIncomingCall(null)
  }, [incomingCall, setIncomingCall])

  if (!incomingCall) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 p-8 rounded-2xl bg-[#1e1f22] border border-white/10 shadow-2xl max-w-sm w-[90%]">
        <div className="relative flex items-center justify-center">
          <RingingAnimation />
          <Avatar className="relative z-10 w-24 h-24 ring-4 ring-green-500/50">
            {incomingCall.callerAvatar ? (
              <AvatarImage src={incomingCall.callerAvatar} alt={incomingCall.callerName} />
            ) : null}
            <AvatarFallback className="text-2xl font-bold bg-green-600 text-white">
              {getInitials(incomingCall.callerName)}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-white">{incomingCall.callerName}</h2>
          <div className="flex items-center justify-center gap-2 text-green-400">
            <PhoneIncoming className="w-4 h-4 animate-bounce" />
            <span className="text-sm font-medium">Incoming Call</span>
          </div>
        </div>

        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-red-500/60 transition-all duration-1000 ease-linear"
            style={{ width: `${(countdown / 30) * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-6">
          <Button
            variant="ghost"
            size="lg"
            className="w-16 h-16 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/30 transition-colors"
            onClick={handleDecline}
            aria-label="Decline call"
          >
            <PhoneOff className="w-7 h-7" />
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-16 h-16 rounded-full bg-green-500/20 hover:bg-green-500/30 text-green-400 hover:text-green-300 border border-green-500/30 transition-colors"
            onClick={handleAccept}
            aria-label="Accept call"
          >
            <Phone className="w-7 h-7" />
          </Button>
        </div>

        <span className="text-xs text-muted-foreground">
          {countdown}s remaining
        </span>
      </div>
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Outgoing Call Overlay
// ═══════════════════════════════════════════════════════════════════════════

function OutgoingCallOverlay() {
  const activeCall = useAppStore((s) => s.activeCall)
  const setActiveCall = useAppStore((s) => s.setActiveCall)

  useEffect(() => {
    if (activeCall?.status === 'ringing') playRingtone()
    return () => stopRingtone()
  }, [activeCall])

  const handleCancel = useCallback(() => {
    if (!activeCall) return
    stopRingtone()
    cleanupDMCall()
    hangUpCall(activeCall.dmConversationId)
    setActiveCall(null)
  }, [activeCall, setActiveCall])

  if (!activeCall || activeCall.status !== 'ringing') return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 p-8 rounded-2xl bg-[#1e1f22] border border-white/10 shadow-2xl max-w-sm w-[90%]">
        <div className="relative flex items-center justify-center">
          <RingingAnimation />
          <Avatar className="relative z-10 w-24 h-24 ring-4 ring-blue-500/50">
            {activeCall.callerAvatar ? (
              <AvatarImage src={activeCall.callerAvatar} alt={activeCall.callerName} />
            ) : null}
            <AvatarFallback className="text-2xl font-bold bg-blue-600 text-white">
              {getInitials(activeCall.callerName)}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-white">{activeCall.callerName}</h2>
          <div className="flex items-center justify-center gap-2 text-blue-400">
            <PhoneOutgoing className="w-4 h-4 animate-bounce" />
            <span className="text-sm font-medium">Calling...</span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="lg"
          className="w-16 h-16 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors"
          onClick={handleCancel}
          aria-label="Cancel call"
        >
          <PhoneOff className="w-7 h-7" />
        </Button>
      </div>
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Active Call Bar
// ═══════════════════════════════════════════════════════════════════════════

function ActiveCallBar() {
  const activeCall = useAppStore((s) => s.activeCall)
  const isCallMuted = useAppStore((s) => s.isCallMuted)
  const isCallDeafened = useAppStore((s) => s.isCallDeafened)
  const setActiveCall = useAppStore((s) => s.setActiveCall)
  const setCallMuted = useAppStore((s) => s.setCallMuted)
  const setCallDeafened = useAppStore((s) => s.setCallDeafened)
  const [duration, setDuration] = useState('0:00')
  const [isSpeaking, setIsSpeaking] = useState(false)

  // Timer for call duration
  useEffect(() => {
    if (!activeCall?.startedAt || activeCall.status !== 'connected') return

    const interval = setInterval(() => {
      setDuration(formatDuration(activeCall.startedAt))
    }, 1000)

    return () => clearInterval(interval)
  }, [activeCall?.startedAt, activeCall?.status])

  // Speaking detection
  useEffect(() => {
    if (!activeCall?.startedAt || activeCall.status !== 'connected') return
    if (!dmLocalStream) return

    let animFrame = 0
    let prevSpeaking = false

    // Create a dedicated analyser for speaking detection
    const analyserCtx = new AudioContext({ sampleRate: 48000 })
    const analyser = analyserCtx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.85
    const source = analyserCtx.createMediaStreamSource(dmLocalStream)
    source.connect(analyser)

    const detect = () => {
      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const level = Math.sqrt(sum / data.length) * 100
      const nowSpeaking = level > 10 && !dmIsMuted
      if (nowSpeaking !== prevSpeaking) {
        prevSpeaking = nowSpeaking
        setIsSpeaking(nowSpeaking)
      }
      animFrame = requestAnimationFrame(detect)
    }

    animFrame = requestAnimationFrame(detect)

    return () => {
      cancelAnimationFrame(animFrame)
      source.disconnect()
      analyser.disconnect()
      analyserCtx.close().catch(() => {})
    }
  }, [activeCall?.startedAt, activeCall?.status])

  // ─── ONLY the caller creates the offer ──────────────────────────────────
  // The callee (isCaller: false) waits for incoming offers.
  // IMPORTANT: dmLocalStream is a module variable (not React state), so this
  // effect won't re-run when it becomes available. We therefore await
  // setupLocalStream() inside the effect if the stream isn't ready yet — this
  // fixes the race where the callee accepts before the caller's mic capture
  // finishes, which previously caused the offer to never be created.
  useEffect(() => {
    if (!activeCall || activeCall.status !== 'connected') return
    if (!activeCall.isCaller) return // Only caller creates offers
    if (dmPeerConnection) return // Already created
    if (dmSignalingState !== 'idle') return

    let cancelled = false
    const run = async () => {
      // Ensure we have a local stream before attempting to create the offer
      if (!dmLocalStream) {
        await setupLocalStream()
      }
      if (cancelled) return
      if (!dmLocalStream) {
        return
      }
      if (dmPeerConnection || dmSignalingState !== 'idle') return // created concurrently
      createOffer(activeCall.dmConversationId, activeCall.callerId).catch((err) => {
      })
    }
    run()
    return () => { cancelled = true }
  }, [activeCall?.status, activeCall?.dmConversationId, activeCall?.callerId, activeCall?.isCaller])

  const handleHangUp = useCallback(() => {
    if (!activeCall) return
    cleanupDMCall()
    hangUpCall(activeCall.dmConversationId)
    setActiveCall(null)
    setCallMuted(false)
    setCallDeafened(false)
    setIsSpeaking(false)
  }, [activeCall, setActiveCall, setCallMuted, setCallDeafened])

  const handleToggleMute = useCallback(() => {
    const newMuted = !isCallMuted
    setCallMuted(newMuted)
    setDMCallMuted(newMuted)
  }, [isCallMuted, setCallMuted])

  const handleToggleDeafen = useCallback(() => {
    const newDeafened = !isCallDeafened
    setCallDeafened(newDeafened)
    setDMCallDeafened(newDeafened)
    // Deafen also mutes
    if (newDeafened && !isCallMuted) {
      setCallMuted(true)
      setDMCallMuted(true)
    }
  }, [isCallDeafened, isCallMuted, setCallDeafened, setCallMuted])

  if (!activeCall || activeCall.status !== 'connected') return null

  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 z-[100]">
      <div className="mx-auto max-w-lg">
        <div className="mx-3 mb-3 flex items-center justify-between rounded-xl bg-[#1e1f22] border border-white/10 shadow-xl px-4 py-3">
          {/* Left: caller info + duration */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div className={cn(
                'absolute inset-0 rounded-full animate-pulse',
                isSpeaking && !isCallMuted ? 'bg-green-500/40' : 'bg-green-500/20'
              )} />
              <Avatar className={cn(
                'relative w-10 h-10 ring-2 transition-colors',
                isSpeaking && !isCallMuted ? 'ring-green-400' : 'ring-green-500'
              )}>
                {activeCall.callerAvatar ? (
                  <AvatarImage src={activeCall.callerAvatar} alt={activeCall.callerName} />
                ) : null}
                <AvatarFallback className="text-xs font-bold bg-green-600 text-white">
                  {getInitials(activeCall.callerName)}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {activeCall.callerName}
              </p>
              <div className="flex items-center gap-1.5">
                {isSpeaking && !isCallMuted ? (
                  <Volume2 className="w-3 h-3 text-green-400" />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                )}
                <span className="text-xs text-green-400 font-medium tabular-nums">
                  {duration}
                </span>
              </div>
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1.5">
            {/* Noise suppression indicator — always shown (native browser NS is always on) */}
            <div className="flex items-center gap-1 px-2 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20" title="Noise suppression active">
              <AudioWaveform className="w-3.5 h-3.5 text-emerald-400" />
            </div>

            {/* Mute/Unmute */}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'w-10 h-10 rounded-full border transition-all',
                isCallMuted
                  ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-muted-foreground border-white/10'
              )}
              onClick={handleToggleMute}
              aria-label={isCallMuted ? 'Unmute' : 'Mute'}
            >
              {isCallMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>

            {/* Deafen/Undeafen */}
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'w-10 h-10 rounded-full border transition-all',
                isCallDeafened
                  ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-muted-foreground border-white/10'
              )}
              onClick={handleToggleDeafen}
              aria-label={isCallDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isCallDeafened ? <VolumeX className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
            </Button>

            {/* Hang Up */}
            <Button
              variant="ghost"
              size="icon"
              className="w-10 h-10 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors"
              onClick={handleHangUp}
              aria-label="Hang up"
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main DMCallUI Component — handles WebRTC signal events
// ═══════════════════════════════════════════════════════════════════════════

export function DMCallUI() {
  const activeCall = useAppStore((s) => s.activeCall)
  const setActiveCall = useAppStore((s) => s.setActiveCall)
  const setCallMuted = useAppStore((s) => s.setCallMuted)
  const setCallDeafened = useAppStore((s) => s.setCallDeafened)
  const incomingCall = useAppStore((s) => s.incomingCall)

  // ─── Socket listeners for DM call incoming/connected/ended (self-contained) ─
  useEffect(() => {
    const onIncoming = (data: any) => {
      const s = useAppStore.getState()
      s.setIncomingCall({
        dmConversationId: data.dmConversationId,
        callerId: data.callerId,
        callerName: data.callerName,
        callerAvatar: data.callerAvatar,
      })
    }

    const onConnected = (data: any) => {
      stopRingtone()
      const s = useAppStore.getState()
      const existingCall = s.activeCall
      s.setActiveCall({
        ...existingCall,
        dmConversationId: data.dmConversationId,
        callerId: existingCall?.callerId || data.otherUserId,
        callerName: existingCall?.callerName || data.otherName,
        callerAvatar: existingCall?.callerAvatar || data.otherAvatar,
        status: 'connected',
        startedAt: data.startedAt || new Date().toISOString(),
        isCaller: existingCall?.isCaller ?? false,
      })
      s.setIncomingCall(null)
    }

    const onEnded = (data: any) => {
      stopRingtone()
      cleanupDMCall()
      const s = useAppStore.getState()
      s.setActiveCall(null)
      s.setIncomingCall(null)
      s.setCallMuted(false)
      s.setCallDeafened(false)
    }

    onSocketEvent('dm:call:incoming', onIncoming)
    onSocketEvent('dm:call:connected', onConnected)
    onSocketEvent('dm:call:ended', onEnded)

    return () => {
      offSocketEvent('dm:call:incoming', onIncoming)
      offSocketEvent('dm:call:connected', onConnected)
      offSocketEvent('dm:call:ended', onEnded)
    }
  }, [])

  // ─── Socket listener for DM call signals ─────────────────────────────────
  useEffect(() => {
    const handler = async (data: any) => {
      const { fromUserId, dmConversationId, signal } = data


      // Only handle signals for our active call
      const currentCall = useAppStore.getState().activeCall
      if (!currentCall) {
        return
      }
      if (currentCall.dmConversationId !== dmConversationId) {
        return
      }

      if (signal.type === 'offer') {
        // Callee receives offer from caller
        if (!dmLocalStream) {
          await setupLocalStream()
        }
        await handleIncomingOffer(dmConversationId, fromUserId, signal)
      } else if (signal.type === 'answer') {
        // Caller receives answer from callee
        await handleAnswer(data)
      } else if (signal.type === 'ice-candidate') {
        await handleICECandidate(signal)
      }
    }

    onSocketEvent('dm:call:signal', handler)

    return () => {
      offSocketEvent('dm:call:signal', handler)
    }
  }, [])

  // ─── Set up local stream when outgoing call is initiated (caller) ────────
  useEffect(() => {
    if (activeCall?.status === 'ringing' && activeCall.isCaller) {
      // Pre-capture mic while ringing so it's ready when call connects
      setupLocalStream().catch(() => {})
    }
  }, [activeCall?.status === 'ringing'])

  // ─── Clean up when call ends ─────────────────────────────────────────────
  useEffect(() => {
    if (!activeCall && !incomingCall) {
      stopRingtone()
      cleanupDMCall()
    }
  }, [activeCall, incomingCall])

  // ─── Safety: stop ringtone whenever there is no ringing or incoming call ─
  useEffect(() => {
    const hasRinging = activeCall?.status === 'ringing'
    const hasIncoming = !!incomingCall
    if (!hasRinging && !hasIncoming) {
      stopRingtone()
    }
  }, [activeCall, incomingCall])

  // ─── Reset mute/deafen on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopRingtone()
      cleanupDMCall()
    }
  }, [])

  return (
    <>
      <IncomingCallOverlay />
      <OutgoingCallOverlay />
      <ActiveCallBar />
    </>
  )
}