import { describe, expect, it } from "vitest";
import { alawToLinear, decodeWav, encodeWav, linearToMulaw, mulawToLinear } from "./wav.ts";

function wavWith(format: number, bits: number, channels: number, payload: Uint8Array, sampleRate = 8000): Uint8Array {
  const extensible = format === 0xfffe;
  const fmtSize = extensible ? 40 : 16;
  const out = new Uint8Array(12 + 8 + fmtSize + 8 + payload.length);
  const view = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, out.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  if (extensible) {
    view.setUint16(36, 22, true);
    view.setUint16(44, 3, true);
  }
  const data = 20 + fmtSize;
  ascii(data, "data");
  view.setUint32(data + 4, payload.length, true);
  out.set(payload, data + 8);
  return out;
}

describe("WAV", () => {
  it("round-trips 16-bit PCM within one quantisation step", () => {
    const left = Float32Array.from({ length: 400 }, (_, i) => Math.sin(i / 7) * 0.8);
    const right = Float32Array.from({ length: 400 }, (_, i) => Math.cos(i / 5) * 0.3);
    const pcm = decodeWav(encodeWav({ sampleRate: 16_000, channels: [left, right] }));
    expect(pcm.sampleRate).toBe(16_000);
    expect(pcm.channels).toHaveLength(2);
    for (let i = 0; i < 400; i++) {
      expect(Math.abs(pcm.channels[0]![i]! - left[i]!)).toBeLessThan(2 / 32_768);
      expect(Math.abs(pcm.channels[1]![i]! - right[i]!)).toBeLessThan(2 / 32_768);
    }
  });

  it("decodes mu-law and A-law recordings", () => {
    const mulaw = decodeWav(wavWith(7, 8, 1, Uint8Array.from([0xff, 0x80, 0x00])));
    expect(Array.from(mulaw.channels[0]!, (x) => Math.round(x * 32768))).toEqual([0, 32124, -32124]);
    const alaw = decodeWav(wavWith(6, 8, 1, Uint8Array.from([0xd5, 0x55])));
    expect(Array.from(alaw.channels[0]!, (x) => Math.round(x * 32768))).toEqual([8, -8]);
  });

  it("decodes extensible float and 8-bit PCM", () => {
    const floats = new Uint8Array(new Float32Array([0.5, -0.25]).buffer);
    expect(Array.from(decodeWav(wavWith(0xfffe, 32, 1, floats)).channels[0]!)).toEqual([0.5, -0.25]);
    expect(Array.from(decodeWav(wavWith(1, 8, 1, Uint8Array.from([128, 192, 64]))).channels[0]!)).toEqual([0, 0.5, -0.5]);
  });

  it("refuses what is not a WAV, and formats it cannot read", () => {
    expect(() => decodeWav(new TextEncoder().encode("ID3 not a wav file"))).toThrow(/RIFF/);
    expect(() => decodeWav(wavWith(2, 4, 1, new Uint8Array(4)))).toThrow(/unsupported format 2/);
  });
});

describe("G.711 mu-law", () => {
  it("matches the reference code points", () => {
    expect(linearToMulaw(0)).toBe(0xff);
    expect(linearToMulaw(32767)).toBe(0x80);
    expect(linearToMulaw(-32768)).toBe(0x00);
    expect(mulawToLinear(0xff)).toBe(0);
  });

  it("keeps its error within the companding step everywhere", () => {
    for (let x = -32000; x <= 32000; x += 97) {
      const back = mulawToLinear(linearToMulaw(x));
      expect(Math.abs(back - x)).toBeLessThanOrEqual(Math.max(8, Math.abs(x) / 16));
    }
  });
});

describe("G.711 A-law", () => {
  it("is odd-symmetric about the sign bit", () => {
    for (let code = 0; code < 128; code++) expect(alawToLinear(code | 0x80)).toBe(-alawToLinear(code));
  });
});
