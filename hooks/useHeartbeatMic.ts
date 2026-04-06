import { useEffect, useRef, useState, useCallback } from "react";
import { Buffer } from "buffer";
import { ExpoPlayAudioStream } from "@cjblack/expo-audio-stream";

// Helper: base64 PCM16LE -> Int16Array
function base64ToInt16(base64: string) {
  const u8 = new Uint8Array(Buffer.from(base64, "base64"));
  return new Int16Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 2));
}

type UseHeartbeatMicOpts = {
  sampleRate?: number;      // e.g. 16000
  windowSeconds?: number;   // e.g. 4
};

export function useHeartbeatMic(opts: UseHeartbeatMicOpts = {}) {
  const sampleRate = opts.sampleRate ?? 16000;
  const windowSeconds = opts.windowSeconds ?? 4;

  // ---- UI / debug ----
  const [level, setLevel] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // ---- Ring buffer for raw samples ----
  const windowSize = Math.floor(sampleRate * windowSeconds);
  const ringRef = useRef<Float32Array>(new Float32Array(windowSize));
  const writeIndexRef = useRef(0);        // where next samples write
  const filledRef = useRef(0);            // how many valid samples we have (<= windowSize)

  // Optional: keep last few frames for debugging only (you had this)
  const framesRef = useRef<Float32Array[]>([]);

  const appendToRing = useCallback((samples: Float32Array) => {
    const ring = ringRef.current;
    let w = writeIndexRef.current;

    for (let i = 0; i < samples.length; i++) {
      ring[w] = samples[i];
      w++;
      if (w >= ring.length) w = 0;
    }

    writeIndexRef.current = w;
    filledRef.current = Math.min(ring.length, filledRef.current + samples.length);

    const readyNow = filledRef.current >= ring.length;
    if (readyNow !== isReady) setIsReady(readyNow);
  }, [isReady]);

  const getLatestWindow = useCallback((): Float32Array | null => {
    if (filledRef.current < windowSize) return null;

    const ring = ringRef.current;
    const out = new Float32Array(windowSize);

    // writeIndex points to the *next* slot to write,
    // so the newest sample is at writeIndex-1
    const start = writeIndexRef.current; // oldest sample in the window

    // Copy in two chunks (end of ring, then beginning)
    const tailLen = ring.length - start;
    out.set(ring.subarray(start), 0);
    out.set(ring.subarray(0, start), tailLen);

    return out;
  }, [windowSize]);

  const getNormalizedWindow = useCallback((): Float32Array | null => {
    const x = getLatestWindow();
    if (!x) return null;

    // Mean remove (DC offset)
    let mean = 0;
    for (let i = 0; i < x.length; i++) mean += x[i];
    mean /= x.length;
    for (let i = 0; i < x.length; i++) x[i] -= mean;

    // RMS normalize (handles different mic sensitivity / pressure)
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length) || 1e-8;
    const scale = 0.1 / rms; // target RMS ~0.1 (arbitrary but stable)
    for (let i = 0; i < x.length; i++) x[i] *= scale;

    return x;
  }, [getLatestWindow]);

  useEffect(() => {
    const sub = ExpoPlayAudioStream.subscribeToAudioEvents(async (event) => {
      if (!event?.data) return;

      let samples: Float32Array;

      if (typeof event.data === "string") {
        const i16 = base64ToInt16(event.data);
        samples = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) samples[i] = i16[i] / 32768;
      } else if (event.data instanceof Float32Array) {
        samples = event.data;
      } else {
        samples = new Float32Array(event.data as ArrayBufferLike);
      }

      // Save a few frames for debugging only
      framesRef.current.push(samples);
      if (framesRef.current.length > 50) framesRef.current.shift();

      // Update ring buffer (this is the important part)
      appendToRing(samples);

      // RMS meter (your existing signal check)
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      setLevel(Math.sqrt(sum / samples.length));
    });

    return () => sub?.remove?.();
  }, [appendToRing]);

  async function start() {
    await ExpoPlayAudioStream.startRecording({
      sampleRate,
      channels: 1,
      encoding: "pcm_16bit",
      interval: 50,
    });
  }

  async function stop() {
    await ExpoPlayAudioStream.stopRecording();
  }


  const resetBuffer = useCallback(() => {
    writeIndexRef.current = 0;
    filledRef.current = 0;
    ringRef.current.fill(0);
    framesRef.current = [];
    setIsReady(false);
    setLevel(0);
  }, []);


  const getPreviewWindow = useCallback((): Float32Array => {
    const ring = ringRef.current;
    const filled = filledRef.current;
    const N = ring.length;

    if (filled <= 0) return new Float32Array(0);

    const outLen = Math.min(filled, N);
    const out = new Float32Array(outLen);

    // start index of oldest available sample
    const start = (writeIndexRef.current - outLen + N) % N;

    const tailLen = Math.min(N - start, outLen);
    out.set(ring.subarray(start, start + tailLen), 0);
    if (tailLen < outLen) {
      out.set(ring.subarray(0, outLen - tailLen), tailLen);
    }
    return out;
  }, []);



  return {
    start,
    stop,
    level,
    isReady,
    windowSize,
    sampleRate,
    windowSeconds,
    // For ML:
    getLatestWindow,
    getNormalizedWindow,
    // Debug only:
    getFrames: () => framesRef.current,
    resetBuffer,
    getPreviewWindow
  };
}
