import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";

function float32ToInt16PCM(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = x[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    out[i] = Math.round(s * 32767);
  }
  return out;
}

function makeWavBytes(pcm16: Int16Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm16.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);            // PCM chunk size
  buffer.writeUInt16LE(1, 20);             // audio format PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // PCM data
  for (let i = 0; i < pcm16.length; i++) {
    buffer.writeInt16LE(pcm16[i], 44 + i * 2);
  }

  return new Uint8Array(buffer);
}

export async function saveWindowAsWav(
  window: Float32Array,
  sampleRate: number
): Promise<string> {
  const pcm16 = float32ToInt16PCM(window);
  const wavBytes = makeWavBytes(pcm16, sampleRate);

  const uri = `${FileSystem.cacheDirectory}heartbeat_8s.wav`;
  const base64 = Buffer.from(wavBytes).toString("base64");

  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: "base64" as any,
  });

  return uri;
}
