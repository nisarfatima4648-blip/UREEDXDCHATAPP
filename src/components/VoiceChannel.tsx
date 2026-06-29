'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Phone, PhoneOff, Volume2, Mic, MicOff, Loader2 } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { joinVC, leaveVC, sendVCSignal, onSocketEvent, offSocketEvent } from '@/lib/socket'
import { cn } from '@/lib/utils'
import type { VoiceSession } from '@/lib/database'

// ─── Constants ──────────────────────────────────────────────────────────────

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}
const SPEAKING_THRESHOLD = 10

// Audio constraints — browser built-in echo cancellation + noise suppression
const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
}

function getAudioConstraints(): MediaStreamConstraints {
  try {
    const raw = localStorage.getItem('ureedxdchat_audio_settings')
    if (raw) {
      const s = JSON.parse(raw)
      if (s.inputDeviceId) {
        return {
          audio: {
            deviceId: { exact: s.inputDeviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        }
      }
    }
  } catch {}
  return AUDIO_CONSTRAINTS
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

// ─── Audio Wave Animation ────────────────────────────────────────────────────

function AudioWave({ speaking }: { speaking: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            'w-[3px] rounded-full bg-green-500 transition-all duration-150',
            speaking && 'animate-pulse'
          )}
          style={{
            height: speaking ? `${8 + Math.random() * 4}px` : '3px',
            animationDelay: speaking ? `${i * 150}ms` : undefined,
          }}
        />
      ))}
    </div>
  )
}

// ─── Participant ───────────────────────────────────────────────────────────

function VParticipant({
  session,
  isCurrentUser,
  speaking,
  isMuted,
}: {
  session: VoiceSession
  isCurrentUser: boolean
  speaking: boolean
  isMuted?: boolean
}) {
  const user = session.user
  const name = user?.display_name || user?.username || 'Unknown'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent/30 transition-colors cursor-default">
          <div className="relative">
            <Avatar className="size-8">
              {user?.avatar_url ? (
                <AvatarImage src={user.avatar_url} alt={name} />
              ) : null}
              <AvatarFallback className="text-[10px] bg-green-900/60 text-green-300">
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>
            {/* Green speaking ring */}
            {speaking && (
              <div className="absolute -inset-0.5 rounded-full border-2 border-green-500 animate-pulse" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span
              className={cn(
                'text-xs font-medium truncate leading-tight',
                isCurrentUser ? 'text-green-400' : 'text-foreground'
              )}
            >
              {name}
              {isCurrentUser && <span className="text-[10px] text-muted-foreground ml-1">(you)</span>}
            </span>
            <div className="flex items-center gap-1">
              {isMuted && isCurrentUser ? (
                <MicOff className="size-2.5 text-red-400" />
              ) : (
                <AudioWave speaking={speaking} />
              )}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {name} {isCurrentUser ? '(you)' : ''}
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Speaking Detection Helper ─────────────────────────────────────────────

function getAudioLevel(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / data.length) * 100
}

// ─── VoiceChannel Component ────────────────────────────────────────────────

interface VoiceChannelProps {
  gcId: string
}

export function VoiceChannel({ gcId }: VoiceChannelProps) {
  const currentUser = useAppStore((s) => s.currentUser)
  const voiceParticipants = useAppStore((s) => s.voiceParticipants[gcId]) || []
  const removeVoiceParticipant = useAppStore((s) => s.removeVoiceParticipant)

  const isConnected = voiceParticipants.some((p) => p.user_id === currentUser?.id)

  // ─── UI State ─────────────────────────────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [isMuted, setIsMuted] = useState(false)
  const [localSpeaking, setLocalSpeaking] = useState(false)
  const [remoteSpeakingSet, setRemoteSpeakingSet] = useState<Set<string>>(new Set())

  // ─── WebRTC Refs ───────────────────────────────────────────────────────────
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const audioCtxRef = useRef<AudioContext | null>(null)
  const localAnalyserRef = useRef<AnalyserNode | null>(null)
  const remoteAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map())
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const speakingFrameRef = useRef<number>(0)
  const offeredPeersRef = useRef<Set<string>>(new Set()) // track who we've already sent offers to
  const prevConnectedRef = useRef(false)
  const audioContainerRef = useRef<HTMLDivElement>(null)

  // ─── Cleanup all WebRTC resources ──────────────────────────────────────────
  const cleanupWebRTC = useCallback(() => {
    // Stop speaking detection loop
    if (speakingFrameRef.current) {
      cancelAnimationFrame(speakingFrameRef.current)
      speakingFrameRef.current = 0
    }

    // Close all peer connections
    peersRef.current.forEach((pc) => {
      pc.close()
    })
    peersRef.current.clear()
    offeredPeersRef.current.clear()

    // Stop local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }

    // Close remote audio elements
    remoteAudioElsRef.current.forEach((el) => {
      el.srcObject = null
      el.remove()
    })
    remoteAudioElsRef.current.clear()

    // Close remote analysers
    remoteAnalysersRef.current.clear()

    // Close audio context
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    localAnalyserRef.current = null

    setLocalSpeaking(false)
    setRemoteSpeakingSet(new Set())
    setIsMuted(false)
  }, [])

  // ─── Create a peer connection to a specific user ──────────────────────────
  const createPeerConnection = useCallback(
    async (targetUserId: string, shouldCreateOffer: boolean) => {
      const localStream = localStreamRef.current
      if (!localStream) return

      // Don't create duplicate connections
      if (peersRef.current.has(targetUserId)) return
      if (offeredPeersRef.current.has(targetUserId) && shouldCreateOffer) return

      const pc = new RTCPeerConnection(ICE_CONFIG)
      peersRef.current.set(targetUserId, pc)

      // Add local tracks
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream)
      })

      // Handle remote tracks
      pc.ontrack = (event) => {
        const remoteStream = event.streams && event.streams[0]
          ? event.streams[0]
          : new MediaStream([event.track])

        console.log('[VC] ontrack fired for', targetUserId, 'track:', event.track.kind, 'enabled:', event.track.enabled, 'readyState:', event.track.readyState)

        // Create or update audio element for playback
        let audioEl = remoteAudioElsRef.current.get(targetUserId)
        if (!audioEl) {
          audioEl = document.createElement('audio')
          audioEl.autoplay = true
          ;(audioEl as any).playsInline = true
          audioEl.volume = 1
          // Element must NOT be muted for audio to play
          audioEl.muted = false
          audioContainerRef.current?.appendChild(audioEl)
          remoteAudioElsRef.current.set(targetUserId, audioEl)
        }
        audioEl.srcObject = remoteStream

        // Resume the AudioContext (autoplay policy may have suspended it) so that
        // downstream audio routing works and the <audio> element can play.
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {})
        }

        // Retry play() up to 5 times — browser autoplay policy may block first attempts
        const playRemote = (attempt: number) => {
          if (!audioEl) return
          // Ensure element is not muted (deafen state may have flipped it)
          if (!audioEl.muted) audioEl.muted = false
          audioEl.play().then(() => {
            console.log('[VC] Remote audio playing for', targetUserId, 'attempt', attempt)
          }).catch(async (err) => {
            console.warn('[VC] play() failed for', targetUserId, 'attempt', attempt, err?.name)
            if (attempt < 5) {
              await new Promise(r => setTimeout(r, 250))
              playRemote(attempt + 1)
            } else {
              // Last resort: force unmute + set volume + retry once more
              audioEl!.muted = false
              audioEl!.volume = 1
              audioEl!.play().catch(() => {})
            }
          })
        }
        playRemote(0)

        // Create analyser for remote speaking detection
        if (audioCtxRef.current && !remoteAnalysersRef.current.has(targetUserId)) {
          try {
            const analyser = audioCtxRef.current.createAnalyser()
            analyser.fftSize = 512
            analyser.smoothingTimeConstant = 0.8
            const source = audioCtxRef.current.createMediaStreamSource(remoteStream)
            source.connect(analyser)
            // Do NOT connect analyser to destination - audio plays via the <audio> element
            remoteAnalysersRef.current.set(targetUserId, analyser)
          } catch {
            // Ignore if audio context can't tap into remote stream
          }
        }
      }

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendVCSignal(gcId, targetUserId, {
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
          })
        }
      }

      // Handle connection state
      pc.onconnectionstatechange = () => {
        console.log('[VC] Peer', targetUserId, 'connectionState:', pc.connectionState, 'iceState:', pc.iceConnectionState)
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          const analyser = remoteAnalysersRef.current.get(targetUserId)
          if (analyser) {
            remoteAnalysersRef.current.delete(targetUserId)
          }
          const audioEl = remoteAudioElsRef.current.get(targetUserId)
          if (audioEl) {
            audioEl.srcObject = null
            audioEl.remove()
            remoteAudioElsRef.current.delete(targetUserId)
          }
          peersRef.current.delete(targetUserId)
          offeredPeersRef.current.delete(targetUserId)
          setRemoteSpeakingSet((prev) => {
            const next = new Set(prev)
            next.delete(targetUserId)
            return next
          })
        }
      }

      // Track ICE gathering/connection for diagnostics
      pc.onicegatheringstatechange = () => {
        console.log('[VC] Peer', targetUserId, 'ICE gathering:', pc.iceGatheringState)
      }
      pc.oniceconnectionstatechange = () => {
        console.log('[VC] Peer', targetUserId, 'ICE connection:', pc.iceConnectionState)
      }

      if (shouldCreateOffer) {
        offeredPeersRef.current.add(targetUserId)
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
          await pc.setLocalDescription(offer)
          console.log('[VC] Sending offer to', targetUserId, 'SDP len:', pc.localDescription?.sdp?.length)
          sendVCSignal(gcId, targetUserId, {
            type: 'offer',
            sdp: pc.localDescription?.sdp,
          })
        } catch (err) {
          console.error('[VC] Failed to create offer:', err)
          peersRef.current.delete(targetUserId)
          offeredPeersRef.current.delete(targetUserId)
        }
      }
    },
    [gcId]
  )

  // ─── Handle incoming WebRTC signal ────────────────────────────────────────
  const handleSignal = useCallback(
    async (data: any) => {
      if (data.gcId !== gcId) return
      const { fromUserId, signal } = data

      console.log('[VC] Signal received:', signal.type, 'from:', fromUserId)

      if (signal.type === 'offer') {
        // Incoming offer — create peer (no offer) and send answer
        createPeerConnection(fromUserId, false).then(async () => {
          const pc = peersRef.current.get(fromUserId)
          if (!pc) {
            console.warn('[VC] No peer connection after create for', fromUserId)
            return
          }

          try {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            console.log('[VC] Sending answer to', fromUserId, 'SDP len:', pc.localDescription?.sdp?.length)
            sendVCSignal(gcId, fromUserId, {
              type: 'answer',
              sdp: pc.localDescription?.sdp,
            })
          } catch (err) {
            console.error('[VC] Failed to handle offer:', err)
          }
        })
      } else if (signal.type === 'answer') {
        const pc = peersRef.current.get(fromUserId)
        if (!pc) {
          console.warn('[VC] Answer received but no peer for', fromUserId)
          return
        }

        try {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }))
          console.log('[VC] Answer set for', fromUserId)
        } catch (err) {
          console.error('[VC] Failed to handle answer:', err)
        }
      } else if (signal.type === 'ice-candidate' && signal.candidate) {
        const pc = peersRef.current.get(fromUserId)
        if (!pc) return

        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
        } catch (err) {
          // ICE candidate may arrive after peer is closed — ignore
        }
      }
    },
    [gcId, createPeerConnection]
  )

  // ─── Handle peer left event (for WebRTC cleanup) ─────────────────────────
  const handlePeerLeft = useCallback(
    (data: any) => {
      if (data.gcId !== gcId) return

      // Close peer connection
      const pc = peersRef.current.get(data.userId)
      if (pc) {
        pc.close()
        peersRef.current.delete(data.userId)
      }
      offeredPeersRef.current.delete(data.userId)

      // Remove remote audio
      const audioEl = remoteAudioElsRef.current.get(data.userId)
      if (audioEl) {
        audioEl.srcObject = null
        audioEl.remove()
        remoteAudioElsRef.current.delete(data.userId)
      }

      // Remove remote analyser
      remoteAnalysersRef.current.delete(data.userId)

      setRemoteSpeakingSet((prev) => {
        const next = new Set(prev)
        next.delete(data.userId)
        return next
      })
    },
    [gcId]
  )

  // ─── Speaking detection loop ──────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !localAnalyserRef.current) return

    const localAnalyser = localAnalyserRef.current
    let prevLocalSpeaking = false
    const prevRemoteSpeaking = new Map<string, boolean>()

    const detect = () => {
      // Check local speaking
      const localLevel = getAudioLevel(localAnalyser)
      const nowLocalSpeaking = localLevel > SPEAKING_THRESHOLD && !isMuted
      if (nowLocalSpeaking !== prevLocalSpeaking) {
        prevLocalSpeaking = nowLocalSpeaking
        setLocalSpeaking(nowLocalSpeaking)
      }

      // Check remote speaking
      let remoteChanged = false
      remoteAnalysersRef.current.forEach((analyser, userId) => {
        const level = getAudioLevel(analyser)
        const nowSpeaking = level > SPEAKING_THRESHOLD
        const wasSpeaking = prevRemoteSpeaking.get(userId) || false
        if (nowSpeaking !== wasSpeaking) {
          prevRemoteSpeaking.set(userId, nowSpeaking)
          remoteChanged = true
        }
      })
      if (remoteChanged) {
        const newSet = new Set<string>()
        prevRemoteSpeaking.forEach((speaking, userId) => {
          if (speaking) newSet.add(userId)
        })
        setRemoteSpeakingSet(newSet)
      }

      speakingFrameRef.current = requestAnimationFrame(detect)
    }

    speakingFrameRef.current = requestAnimationFrame(detect)

    return () => {
      if (speakingFrameRef.current) {
        cancelAnimationFrame(speakingFrameRef.current)
        speakingFrameRef.current = 0
      }
    }
  }, [isConnected, isMuted])

  // ─── Socket event listeners ───────────────────────────────────────────────
  useEffect(() => {
    onSocketEvent('vc:signal', handleSignal)
    onSocketEvent('vc:peer-left', handlePeerLeft)
    return () => {
      offSocketEvent('vc:signal', handleSignal)
      offSocketEvent('vc:peer-left', handlePeerLeft)
    }
  }, [handleSignal, handlePeerLeft])

  // ─── Detect when user joins VC and initiate WebRTC ────────────────────────
  useEffect(() => {
    if (!isConnected) {
      prevConnectedRef.current = false
      return
    }

    let aborted = false

    // User just joined — capture mic and create peer connections
    const setupWebRTC = async () => {
      setConnectionStatus('connecting')

      try {
        // Capture microphone
        const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints())
        if (aborted) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        localStreamRef.current = stream
        console.log('[VC] Got local stream, audio tracks:', stream.getAudioTracks().length, stream.getAudioTracks().map(t => `enabled=${t.enabled} ready=${t.readyState} label=${t.label}`))

        // Set up local speaking detection
        const audioCtx = new AudioContext()
        await audioCtx.resume() // Ensure AudioContext is active (autoplay policy)
        audioCtxRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)
        localAnalyserRef.current = analyser

        setConnectionStatus('connected')

        // Create offers to all OTHER participants already in VC
        const otherParticipants = voiceParticipants.filter((p) => p.user_id !== currentUser?.id)
        for (const p of otherParticipants) {
          if (aborted) break
          await createPeerConnection(p.user_id, true)
        }
      } catch (err) {
        if (aborted) return
        console.error('[VC] Failed to set up WebRTC:', err)
        setConnectionStatus('connected') // Still show as connected for presence, just no audio
      }

      if (!aborted) prevConnectedRef.current = true
    }

    setupWebRTC()

    return () => {
      aborted = true
      cleanupWebRTC()
      setConnectionStatus('disconnected')
    }
  }, [isConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cleanup on gcId change ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (isConnected) {
        leaveVC(gcId)
      }
      cleanupWebRTC()
    }
  }, [gcId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cleanupWebRTC()
    }
  }, [cleanupWebRTC])

  // ─── Handle Join ──────────────────────────────────────────────────────────
  const handleJoin = useCallback(() => {
    setConnectionStatus('connecting')
    joinVC(gcId)
  }, [gcId])

  // ─── Handle Leave ─────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    // Optimistically remove self from participants for immediate UI update
    if (currentUser?.id) {
      removeVoiceParticipant(gcId, currentUser.id)
    }
    cleanupWebRTC()
    setConnectionStatus('disconnected')
    leaveVC(gcId)
  }, [gcId, currentUser?.id, removeVoiceParticipant, cleanupWebRTC])

  // ─── Handle Mute/Unmute ───────────────────────────────────────────────────
  const handleMuteToggle = useCallback(() => {
    const newMuted = !isMuted
    setIsMuted(newMuted)

    const stream = localStreamRef.current
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !newMuted
      })
    }
  }, [isMuted])

  return (
    <div
      className={cn(
        'mx-4 mt-2 mb-1 rounded-lg border',
        isConnected
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-border/50 bg-card/80 backdrop-blur-sm',
        'transition-all duration-300'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {isConnected ? (
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            ) : (
              <Volume2 className="size-3.5 text-muted-foreground" />
            )}
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Voice Channel
            </span>
          </div>
          {voiceParticipants.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
              {voiceParticipants.length} {voiceParticipants.length === 1 ? 'person' : 'people'}
            </Badge>
          )}
          {isConnected && connectionStatus === 'connecting' && (
            <Loader2 className="size-3 text-yellow-500 animate-spin" />
          )}
        </div>

        <div className="flex items-center gap-1">
          {isConnected ? (
            <>
              {/* Mute/Unmute */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-8',
                      isMuted
                        ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                        : 'text-green-400 hover:text-green-300 hover:bg-green-500/10'
                    )}
                    onClick={handleMuteToggle}
                  >
                    {isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {isMuted ? 'Unmute' : 'Mute'}
                </TooltipContent>
              </Tooltip>

              {/* Disconnect */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={handleLeave}
                  >
                    <PhoneOff className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Disconnect
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                  onClick={handleJoin}
                >
                  <Phone className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Join Voice
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Participants */}
      {voiceParticipants.length > 0 && (
        <div className="flex flex-wrap gap-1 p-2">
          {voiceParticipants.map((session) => {
            const isMe = session.user_id === currentUser?.id
            const speaking = isMe
              ? localSpeaking
              : remoteSpeakingSet.has(session.user_id)
            return (
              <VParticipant
                key={session.id}
                session={session}
                isCurrentUser={isMe}
                speaking={speaking}
                isMuted={isMe ? isMuted : false}
              />
            )
          })}
        </div>
      )}

      {/* Screen-reader-only container for remote audio elements (must NOT be display:none or audio won't play) */}
      <div ref={audioContainerRef} className="sr-only" />
    </div>
  )
}