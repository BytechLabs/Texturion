/**
 * Local speech-to-text with whisper.cpp, which the rig box installs: free, and
 * nothing leaves the box.
 *
 * whisper.cpp reads 16 kHz mono PCM. Audio in a different format is converted
 * with ffmpeg in a private temporary directory for the length of one run and
 * removed in `finally` whatever happens: the transcript survives, the audio
 * does not (D112).
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Transcriber {
  transcribe(audio: Uint8Array, language?: string): Promise<string>;
}

export type TranscribeExec = (file: string, args: readonly string[], options: { timeoutMs: number }) => Promise<string>;

const execText: TranscribeExec = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: options.timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`whisper: ${file} failed (${error.code ?? error.signal ?? "error"})`));
      else resolve(stdout);
    });
  });

export interface WhisperOptions {
  /** `whisper-cli` from the box's whisper.cpp build. */
  binary: string;
  /** A ggml model file, e.g. ggml-base.en.bin. */
  model: string;
  language?: string;
  timeoutMs?: number;
  /** For audio that is not already WAV. */
  ffmpeg?: string;
  exec?: TranscribeExec;
}

/** The arguments for one file: no timestamps, no progress, the text on stdout. */
export function whisperArgs(options: Pick<WhisperOptions, "model" | "language">, wavPath: string): string[] {
  return ["-m", options.model, "-f", wavPath, "-l", options.language ?? "en", "-nt", "-np"];
}

export class WhisperTranscriber implements Transcriber {
  readonly #o: WhisperOptions;
  readonly #exec: TranscribeExec;

  constructor(options: WhisperOptions) {
    this.#o = options;
    this.#exec = options.exec ?? execText;
  }

  async transcribe(audio: Uint8Array, language = this.#o.language): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "rig-whisper-"));
    try {
      const timeoutMs = this.#o.timeoutMs ?? 120_000;
      let path = join(dir, "audio.wav");
      if (isWhisperWav(audio)) writeFileSync(path, audio, { mode: 0o600 });
      else {
        const input = join(dir, "audio.in");
        writeFileSync(input, audio, { mode: 0o600 });
        path = join(dir, "converted.wav");
        await this.#exec(this.#o.ffmpeg ?? "ffmpeg", ["-v", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", path], { timeoutMs });
      }
      const out = await this.#exec(this.#o.binary, whisperArgs({ model: this.#o.model, language }, path), { timeoutMs });
      return out.replaceAll(/\s+/g, " ").trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function isWhisperWav(bytes: Uint8Array): boolean {
  const header = Buffer.from(bytes.subarray(0, 36));
  return header.length === 36 &&
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 16) === "WAVEfmt " &&
    header.readUInt16LE(20) === 1 &&
    header.readUInt16LE(22) === 1 &&
    header.readUInt32LE(24) === 16_000 &&
    header.readUInt16LE(34) === 16;
}
