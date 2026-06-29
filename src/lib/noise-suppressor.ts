/**
 * noise-suppressor.ts
 *
 * Client-side audio noise suppression module for voice calls.
 * Uses an AudioWorklet-based noise gate (runs on a separate audio thread,
 * avoiding UI jank and the siren artifacts that ScriptProcessorNode caused)
 * combined with native Web Audio nodes for high-pass filtering and dynamics
 * compression.
 *
 * Processing chain:
 *   MediaStreamSource → MuteGain → BiquadFilter(HP 200 Hz)
 *     → AudioWorkletNode(noise gate) → DynamicsCompressor → MediaStreamDestination
 *
 * The MediaStreamDestination's `.stream` is the processed stream that should
 * be fed into the RTCPeerConnection (addTrack) instead of the raw mic tracks.
 *
 * No audio is routed to `audioContext.destination` (speakers) — this module
 * only transforms the mic stream for sending.
 */

// ─── AudioWorklet Processor (inline Blob) ──────────────────────────────────
// This code string is turned into a Blob URL so it works with webpack / bundlers
// without needing a separate .js worklet file on disk.

const NOISE_GATE_WORKLET_CODE = `
'use strict';

/**
 * NoiseGateProcessor
 *
 * A simple, artifact-free noise gate that runs inside an AudioWorklet thread.
 *
 * How it works:
 *  1. Compute RMS energy of the incoming buffer across all channels.
 *  2. Compare against a configurable threshold.
 *  3. State machine: open → hold → closed.
 *     - When RMS > threshold → gate opens immediately and the hold timer resets.
 *     - While RMS ≤ threshold but hold timer > 0 → gate stays open (prevents
 *       chopping word endings).
 *     - When hold expires → gate begins closing.
 *  4. Gain is exponentially smoothed toward the target (1 = open, 0 = closed)
 *     using a time-constant approach, never producing abrupt jumps that could
 *     cause clicks or siren-like artifacts.
 *  5. The smoothed gain is applied sample-by-sample to every channel.
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Current gain applied to output (smoothly interpolated)
    this._gain = 1.0;

    // ── Tuning constants ──────────────────────────────────────────────────
    // RMS threshold — audio quieter than this (in linear amplitude) is
    // considered silence.  0.008 corresponds roughly to -42 dBFS.
    this._threshold = 0.008;

    // Attack time (seconds) — how fast the gate opens when voice is detected.
    // Short attack so the start of speech is not cut off.
    this._attack = 0.015;

    // Hold time (seconds) — after voice drops below threshold, keep the gate
    // open for this long to avoid chopping the tail of words.
    this._hold = 0.15;

    // Release time (seconds) — how fast the gate closes.  Longer release
    // sounds more natural and avoids "pumping" artifacts.
    this._release = 0.25;

    // Remaining hold time (decremented each process() call)
    this._holdRemaining = 0;

    // Whether the gate is logically open
    this._isOpen = true;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    // Pass through silence if there's no input data
    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }

    const bufferSize = input[0].length;
    const channels = Math.min(input.length, output.length);

    // ── 1. Compute RMS across all channels ────────────────────────────────
    let sumSquares = 0;
    for (let ch = 0; ch < channels; ch++) {
      const data = input[ch];
      for (let i = 0; i < bufferSize; i++) {
        sumSquares += data[i] * data[i];
      }
    }
    const rms = Math.sqrt(sumSquares / (channels * bufferSize));

    // Duration of this buffer in seconds (needed for time-constant smoothing)
    const bufferDuration = bufferSize / this.sampleRate;

    // ── 2. Noise gate state machine ───────────────────────────────────────
    if (rms > this._threshold) {
      // Voice detected — open gate and reset hold timer
      this._holdRemaining = this._hold;
      this._isOpen = true;
    } else if (this._holdRemaining > 0) {
      // Below threshold but still in hold period — stay open
      this._holdRemaining -= bufferDuration;
      if (this._holdRemaining < 0) this._holdRemaining = 0;
    } else {
      // Hold expired — close the gate
      this._isOpen = false;
    }

    // ── 3. Smooth gain interpolation (exponential approach) ────────────────
    //   coefficient = 1 - e^(-dt / tau)
    // This gives per-sample-accurate smoothing without discontinuities.
    if (this._isOpen) {
      const coeff = 1.0 - Math.exp(-bufferDuration / this._attack);
      this._gain += (1.0 - this._gain) * coeff;
    } else {
      const coeff = 1.0 - Math.exp(-bufferDuration / this._release);
      this._gain += (0.0 - this._gain) * coeff;
    }

    // Clamp to [0, 1] to prevent numerical drift
    if (this._gain > 1.0) this._gain = 1.0;
    else if (this._gain < 0.0) this._gain = 0.0;

    // ── 4. Apply gain to every sample, every channel ──────────────────────
    const g = this._gain;
    for (let ch = 0; ch < channels; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      for (let i = 0; i < bufferSize; i++) {
        outCh[i] = inCh[i] * g;
      }
    }

    return true; // keep the processor alive
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
`;

// ─── NoiseSuppressor Class ─────────────────────────────────────────────────

/**
 * NoiseSuppressor
 *
 * Wraps a raw mic MediaStream through a Web Audio processing pipeline and
 * exposes a processed MediaStream suitable for RTCPeerConnection.addTrack().
 *
 * Usage:
 * ```ts
 *   const suppressor = await NoiseSuppressor.create(micStream);
 *   const processedTrack = suppressor.processedStream.getAudioTracks()[0];
 *   pc.addTrack(processedTrack, suppressor.processedStream);
 *   // …
 *   suppressor.setMuted(true);  // mute
 *   suppressor.setMuted(false); // unmute
 *   // …
 *   suppressor.destroy();
 * ```
 */
export class NoiseSuppressor {
  /** The Web Audio context (created internally, closed on destroy). */
  private audioContext: AudioContext;

  /** Raw mic stream source node. */
  private sourceNode: MediaStreamAudioSourceNode;

  /** Gain node used for muting (smooth ramp, no clicks). */
  private muteGainNode: GainNode;

  /** High-pass BiquadFilter to cut rumble / hum below 200 Hz. */
  private highPassFilter: BiquadFilterNode;

  /** AudioWorklet noise gate (runs on audio thread). */
  private noiseGateNode: AudioWorkletNode;

  /** Dynamics compressor to normalize voice levels. */
  private compressorNode: DynamicsCompressorNode;

  /** Destination node whose `.stream` is the final processed stream. */
  private destinationNode: MediaStreamAudioDestinationNode;

  /** The original mic stream passed to create(). */
  private _rawStream: MediaStream;

  /** Whether the suppressor is currently muted. */
  private _muted = false;

  /** Blob URL for the worklet (revoked on destroy). */
  private workletBlobURL: string | null = null;

  /** Whether destroy() has been called. */
  private _destroyed = false;

  // ── Private constructor — use NoiseSuppressor.create() ──────────────────
  private constructor(
    audioContext: AudioContext,
    sourceNode: MediaStreamAudioSourceNode,
    muteGainNode: GainNode,
    highPassFilter: BiquadFilterNode,
    noiseGateNode: AudioWorkletNode,
    compressorNode: DynamicsCompressorNode,
    destinationNode: MediaStreamAudioDestinationNode,
    rawStream: MediaStream,
  ) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.muteGainNode = muteGainNode;
    this.highPassFilter = highPassFilter;
    this.noiseGateNode = noiseGateNode;
    this.compressorNode = compressorNode;
    this.destinationNode = destinationNode;
    this._rawStream = rawStream;
  }

  // ── Static factory ──────────────────────────────────────────────────────

  /**
   * Creates a NoiseSuppressor instance for the given mic stream.
   *
   * @param stream - The raw MediaStream obtained from getUserMedia().
   * @returns A ready-to-use NoiseSuppressor.
   * @throws If AudioWorklet is not supported or the worklet fails to load.
   */
  static async create(stream: MediaStream): Promise<NoiseSuppressor> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const NativeAudioCtx = (typeof AudioContext !== 'undefined'
      ? AudioContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (window as any).webkitAudioContext) as typeof AudioContext;

    if (!NativeAudioCtx) {
      throw new Error('NoiseSuppressor: Web Audio API is not supported in this browser.');
    }

    const ctx = new NativeAudioCtx();

    // Resume the AudioContext immediately — autoplay policy may start it in
    // "suspended" state, which would mean no audio flows through the pipeline.
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }

    // ── 1. Create Blob URL for the inline AudioWorklet processor ──────────
    const blob = new Blob([NOISE_GATE_WORKLET_CODE], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);

    let noiseGateNode: AudioWorkletNode;
    try {
      await ctx.audioWorklet.addModule(blobURL);
      noiseGateNode = new AudioWorkletNode(ctx, 'noise-gate-processor');
    } catch (err) {
      URL.revokeObjectURL(blobURL);
      ctx.close();
      throw new Error(
        `NoiseSuppressor: Failed to load noise-gate AudioWorklet. ` +
        `AudioWorklet may not be supported in this browser. Original error: ${err}`,
      );
    }

    // ── 2. Create remaining nodes ─────────────────────────────────────────

    // Source from raw mic stream
    const sourceNode = ctx.createMediaStreamSource(stream);

    // Mute gain (starts at 1 = unmuted)
    const muteGainNode = ctx.createGain();
    muteGainNode.gain.value = 1.0;

    // High-pass filter at 200 Hz to cut low-frequency rumble / hum
    const highPassFilter = ctx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 200;
    highPassFilter.Q.value = 0.7071; // Butterworth (flat passband)

    // Dynamics compressor — gentle voice normalization
    const compressorNode = ctx.createDynamicsCompressor();
    compressorNode.threshold.value = -24;   // Start compressing at -24 dBFS
    compressorNode.knee.value = 12;         // Soft knee for natural sound
    compressorNode.ratio.value = 3;         // Mild 3:1 ratio
    compressorNode.attack.value = 0.003;    // 3 ms attack (fast enough for speech)
    compressorNode.release.value = 0.15;    // 150 ms release

    // Destination — produces a MediaStream (NOT speakers)
    const destinationNode = ctx.createMediaStreamDestination();

    // ── 3. Wire up the processing chain ───────────────────────────────────
    //   Source → MuteGain → HighPass → NoiseGate → Compressor → Destination
    sourceNode.connect(muteGainNode);
    muteGainNode.connect(highPassFilter);
    highPassFilter.connect(noiseGateNode);
    noiseGateNode.connect(compressorNode);
    compressorNode.connect(destinationNode);

    // NOTE: We intentionally do NOT connect anything to ctx.destination
    // because we only want to process audio, not play it through speakers.

    const instance = new NoiseSuppressor(
      ctx,
      sourceNode,
      muteGainNode,
      highPassFilter,
      noiseGateNode,
      compressorNode,
      destinationNode,
      stream,
    );

    // Store the blob URL so we can revoke it on destroy
    instance.workletBlobURL = blobURL;

    return instance;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * The processed MediaStream. Use its audio tracks with
   * `pc.addTrack(track, processedStream)` for WebRTC.
   */
  get processedStream(): MediaStream {
    this._assertAlive();
    return this.destinationNode.stream;
  }

  /**
   * The original raw mic stream that was passed to `create()`.
   */
  get rawStream(): MediaStream {
    return this._rawStream;
  }

  /**
   * Mute or unmute the processed audio. Uses a short linear ramp (10 ms)
   * to avoid clicks.
   *
   * @param muted - `true` to mute, `false` to unmute.
   */
  setMuted(muted: boolean): void {
    this._assertAlive();
    this._muted = muted;
    const now = this.audioContext.currentTime;
    this.muteGainNode.gain.cancelScheduledValues(now);
    this.muteGainNode.gain.setValueAtTime(this.muteGainNode.gain.value, now);
    this.muteGainNode.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.01);
  }

  /**
   * Returns whether the suppressor is currently muted.
   */
  get isMuted(): boolean {
    return this._muted;
  }

  /**
   * Tears down all audio nodes, closes the AudioContext, and revokes the
   * Blob URL. After calling this, the instance must not be used.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    try {
      // Disconnect every node (order doesn't matter, disconnect is idempotent)
      this.sourceNode.disconnect();
      this.muteGainNode.disconnect();
      this.highPassFilter.disconnect();
      this.noiseGateNode.disconnect();
      this.compressorNode.disconnect();
      this.destinationNode.disconnect();
    } catch {
      // Nodes may already be disconnected if context was closed first
    }

    try {
      this.audioContext.close();
    } catch {
      // Context may already be closed
    }

    if (this.workletBlobURL) {
      URL.revokeObjectURL(this.workletBlobURL);
      this.workletBlobURL = null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Throws if destroy() has already been called. */
  private _assertAlive(): void {
    if (this._destroyed) {
      throw new Error('NoiseSuppressor: instance has been destroyed.');
    }
  }
}

// ─── Module-level helpers ───────────────────────────────────────────────────

/**
 * Reads the noise suppression toggle from localStorage.
 * Defaults to `true` (enabled) if not explicitly set to `false`.
 */
export function isNoiseSuppressionEnabled(): boolean {
  try {
    const raw = localStorage.getItem('ureedxdchat_audio_settings')
    if (raw) {
      const s = JSON.parse(raw)
      return s.noiseSuppression !== false
    }
  } catch { /* ignore */ }
  return true
}

/**
 * Convenience wrapper: creates a NoiseSuppressor for the given raw mic stream
 * and returns both the suppressor instance and the processed MediaStream.
 *
 * If noise suppression is disabled in settings OR the NoiseSuppressor fails
 * to initialise (e.g. AudioWorklet not supported), falls back to returning
 * the raw stream with a `null` suppressor — the caller should use the stream
 * either way.
 *
 * @param rawStream - The MediaStream from getUserMedia()
 * @returns `{ suppressor, stream }` — use `stream` for WebRTC, call
 *          `suppressor?.destroy()` when done.
 */
export async function createProcessedStream(
  rawStream: MediaStream,
): Promise<{ suppressor: NoiseSuppressor | null; stream: MediaStream }> {
  if (!isNoiseSuppressionEnabled()) {
    return { suppressor: null, stream: rawStream }
  }

  try {
    const suppressor = await NoiseSuppressor.create(rawStream)
    const processed = suppressor.processedStream
    // Verify the processed stream actually has audio tracks
    if (processed.getAudioTracks().length === 0) {
      console.warn('[NoiseSuppressor] Processed stream has no audio tracks — falling back to raw stream')
      suppressor.destroy()
      return { suppressor: null, stream: rawStream }
    }
    console.log('[NoiseSuppressor] Noise suppression enabled — processed stream ready, tracks:', processed.getAudioTracks().length)
    return { suppressor, stream: processed }
  } catch (err) {
    console.warn('[NoiseSuppressor] Failed to create noise suppressor, using raw stream:', err)
    return { suppressor: null, stream: rawStream }
  }
}