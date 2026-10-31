/**
 * WAV in and out, plus G.711. Recordings arrive from Telnyx as WAV (PCM or
 * G.711 inside), Chrome's fake microphone reads a PCM WAV, and the tests run
 * synthesized audio through mu-law to stand in for the phone network.
 */

export interface Pcm {
  sampleRate: number;
  /** One array per channel, samples in [-1, 1]. */
  channels: Float32Array[];
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_ALAW = 6;
const FORMAT_MULAW = 7;
const FORMAT_EXTENSIBLE = 0xfffe;

/** 16-bit PCM WAV of one or more equal-length channels. */
export function encodeWav(pcm: Pcm): Uint8Array<ArrayBuffer> {
  const channels = pcm.channels.length;
  if (channels === 0) throw new Error("encodeWav: no channels");
  const frames = pcm.channels[0]!.length;
  if (pcm.channels.some((channel) => channel.length !== frames)) {
    throw new Error("encodeWav: channels differ in length");
  }
  const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of pcm.channels) {
      view.setInt16(offset, toInt16(channel[i]!), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Any PCM, float or G.711 WAV, as float channels. */
export function decodeWav(bytes: Uint8Array): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("decodeWav: not a RIFF/WAVE file");
  }
  let format: { code: number; channels: number; sampleRate: number; bits: number } | undefined;
  let data: Uint8Array | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    // Streaming writers leave the data size at 0 or 0xFFFFFFFF; take the rest.
    const end = Math.min(body + size, bytes.byteLength);
    if (id === "fmt ") {
      let code = view.getUint16(body, true);
      if (code === FORMAT_EXTENSIBLE && size >= 40) code = view.getUint16(body + 24, true);
      format = {
        code,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      data = bytes.subarray(body, size === 0 || size === 0xffffffff ? bytes.byteLength : end);
    }
    offset = body + size + (size % 2);
    if (size === 0xffffffff) break;
  }
  if (!format) throw new Error("decodeWav: no fmt chunk");
  if (!data) throw new Error("decodeWav: no data chunk");
  if (format.channels < 1) throw new Error("decodeWav: zero channels");

  const read = sampleReader(format.code, format.bits);
  const bytesPerSample = format.bits / 8;
  const frames = Math.floor(data.byteLength / (bytesPerSample * format.channels));
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < format.channels; c++) {
      channels[c]![i] = read(dataView, (i * format.channels + c) * bytesPerSample);
    }
  }
  return { sampleRate: format.sampleRate, channels };
}

function sampleReader(code: number, bits: number): (view: DataView, offset: number) => number {
  if (code === FORMAT_PCM && bits === 8) return (v, o) => (v.getUint8(o) - 128) / 128;
  if (code === FORMAT_PCM && bits === 16) return (v, o) => v.getInt16(o, true) / 32768;
  if (code === FORMAT_PCM && bits === 24) {
    return (v, o) => {
      const value = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
      return value / 8388608;
    };
  }
  if (code === FORMAT_PCM && bits === 32) return (v, o) => v.getInt32(o, true) / 2147483648;
  if (code === FORMAT_FLOAT && bits === 32) return (v, o) => v.getFloat32(o, true);
  if (code === FORMAT_MULAW && bits === 8) return (v, o) => mulawToLinear(v.getUint8(o)) / 32768;
  if (code === FORMAT_ALAW && bits === 8) return (v, o) => alawToLinear(v.getUint8(o)) / 32768;
  throw new Error(`decodeWav: unsupported format ${code} at ${bits} bits`);
}

function toInt16(sample: number): number {
  const clipped = Math.max(-1, Math.min(1, sample));
  return Math.round(clipped < 0 ? clipped * 32768 : clipped * 32767);
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** G.711 mu-law, from a 16-bit linear sample. */
export function linearToMulaw(sample: number): number {
  let value = Math.round(sample);
  const sign = value < 0 ? 0x80 : 0;
  if (sign) value = -value;
  if (value > MULAW_CLIP) value = MULAW_CLIP;
  value += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** G.711 mu-law, to a 16-bit linear sample. */
export function mulawToLinear(code: number): number {
  const value = ~code & 0xff;
  const exponent = (value >> 4) & 0x07;
  const magnitude = (((value & 0x0f) << 3) + MULAW_BIAS) << exponent;
  return value & 0x80 ? MULAW_BIAS - magnitude : magnitude - MULAW_BIAS;
}

/** G.711 A-law, to a 16-bit linear sample. */
export function alawToLinear(code: number): number {
  const value = code ^ 0x55;
  const segment = (value & 0x70) >> 4;
  let magnitude = (value & 0x0f) << 4;
  if (segment === 0) magnitude += 8;
  else {
    magnitude += 0x108;
    if (segment > 1) magnitude <<= segment - 1;
  }
  return value & 0x80 ? magnitude : -magnitude;
}
