/**
 * Pure helpers for the ffprobe enrichment step: parse `ffprobe -show_format -show_streams -of json` output into a
 * small, typed measurement, then evaluate it against an advisory compatibility baseline. No I/O here.
 *
 * The baseline (H.264 / yuv420p / AAC) is what plays almost everywhere, including iOS Safari. Passing it is NOT proof
 * that a video plays on a given iPhone: only a real-device test shows that. Flags are review hints, nothing more.
 */

export class ProbeParseError extends Error {}

export interface VideoStreamInfo {
  codec: string | null;
  profile: string | null;
  level: number | null;
  pixelFormat: string | null;
  width: number | null;
  height: number | null;
  /** Display rotation in degrees when the file carries one (phone videos often do); null otherwise. */
  rotation: number | null;
}

export interface AudioStreamInfo {
  codec: string | null;
  profile: string | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface Measurement {
  /** ffprobe's container name. For MP4/MOV this is the generic "mov,mp4,m4a,3gp,3g2,mj2". */
  container: string | null;
  /** Distinguishes MP4 brands (isom, mp42, ...) from QuickTime ("qt  "). */
  majorBrand: string | null;
  /** Seconds. null = missing or unparseable. Zero or negative values are kept as-is so they can be reported. */
  durationSeconds: number | null;
  /** First real (non cover-art) video stream. */
  video: VideoStreamInfo | null;
  videoStreamCount: number;
  /** First audio stream. */
  audio: AudioStreamInfo | null;
  audioStreamCount: number;
}

export type FlagSeverity = 'error' | 'warning';
export type FlagCode =
  | 'ffprobe_unreadable'
  | 'archive_mismatch'
  | 'not_in_archive'
  | 'no_video_stream'
  | 'invalid_duration'
  | 'invalid_dimensions'
  | 'unexpected_video_codec'
  | 'unexpected_pixel_format'
  | 'unexpected_audio_codec';

export interface Flag { code: FlagCode; severity: FlagSeverity; detail: string }

export const FLAG_SEVERITY: Record<FlagCode, FlagSeverity> = {
  ffprobe_unreadable: 'error',
  archive_mismatch: 'error',
  not_in_archive: 'error',
  no_video_stream: 'error',
  invalid_duration: 'error',
  invalid_dimensions: 'error',
  unexpected_video_codec: 'warning',
  unexpected_pixel_format: 'warning',
  unexpected_audio_codec: 'warning'
};

export const makeFlag = (code: FlagCode, detail: string): Flag => ({ code, severity: FLAG_SEVERITY[code], detail });

export interface MediaExpectations {
  videoCodecs: readonly string[];
  pixelFormats: readonly string[];
  audioCodecs: readonly string[];
}

/** Advisory baseline. Audio is optional: a silent video is fine; only a present-but-unusual audio codec is flagged. */
export const EXPECTED_MEDIA: MediaExpectations = {
  videoCodecs: ['h264'],
  pixelFormats: ['yuv420p'],
  audioCodecs: ['aac']
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** ffprobe prints many numbers as strings ("1.000000", "44100") and uses "N/A" for unknown. */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && v !== 'N/A') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const int = (v: unknown): number | null => { const n = num(v); return n !== null && Number.isInteger(n) ? n : null; };

function rotationOf(stream: Json): number | null {
  const side = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const sd of side) if (isObj(sd) && num(sd.rotation) !== null) return num(sd.rotation);
  const tags = isObj(stream.tags) ? stream.tags : {};
  return num(tags.rotate);
}

/** Parses ffprobe's JSON text. Throws ProbeParseError when it is not the expected shape. */
export function parseFfprobeJson(text: string): Measurement {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new ProbeParseError('ffprobe output is not valid JSON'); }
  if (!isObj(j)) throw new ProbeParseError('ffprobe output is not a JSON object');
  const format = isObj(j.format) ? j.format : null;
  const streams = Array.isArray(j.streams) ? j.streams.filter(isObj) : [];
  if (!format && streams.length === 0) throw new ProbeParseError('ffprobe output has neither format nor streams');

  const isCoverArt = (s: Json) => isObj(s.disposition) && s.disposition.attached_pic === 1;
  const videos = streams.filter((s) => s.codec_type === 'video' && !isCoverArt(s));
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const v = videos[0];
  const a = audios[0];
  const tags = format && isObj(format.tags) ? format.tags : {};

  return {
    container: format ? str(format.format_name) : null,
    majorBrand: str(tags.major_brand),
    durationSeconds: num(format?.duration) ?? (v ? num(v.duration) : null),
    video: v ? {
      codec: str(v.codec_name)?.toLowerCase() ?? null,
      profile: str(v.profile),
      level: int(v.level),
      pixelFormat: str(v.pix_fmt)?.toLowerCase() ?? null,
      width: int(v.width),
      height: int(v.height),
      rotation: rotationOf(v)
    } : null,
    videoStreamCount: videos.length,
    audio: a ? {
      codec: str(a.codec_name)?.toLowerCase() ?? null,
      profile: str(a.profile),
      sampleRate: int(a.sample_rate),
      channels: int(a.channels)
    } : null,
    audioStreamCount: audios.length
  };
}

/** Applies the baseline. Returns [] for a file that needs no attention. */
export function evaluateMeasurement(m: Measurement, expected: MediaExpectations = EXPECTED_MEDIA): Flag[] {
  const flags: Flag[] = [];

  if (m.durationSeconds === null) flags.push(makeFlag('invalid_duration', 'duration is missing or unreadable'));
  else if (m.durationSeconds <= 0) flags.push(makeFlag('invalid_duration', `duration is ${m.durationSeconds} seconds`));

  if (!m.video) {
    flags.push(makeFlag('no_video_stream', m.audioStreamCount > 0 ? 'the file has audio but no video stream' : 'the file has no video stream'));
  } else {
    const { codec, pixelFormat, width, height } = m.video;
    if (width === null || height === null || width <= 0 || height <= 0) {
      flags.push(makeFlag('invalid_dimensions', `dimensions are ${width ?? '?'}x${height ?? '?'}`));
    }
    if (!codec || !expected.videoCodecs.includes(codec)) {
      flags.push(makeFlag('unexpected_video_codec', `video codec is ${codec ?? 'unknown'}; baseline is ${expected.videoCodecs.join('/')}`));
    }
    if (!pixelFormat || !expected.pixelFormats.includes(pixelFormat)) {
      flags.push(makeFlag('unexpected_pixel_format', `pixel format is ${pixelFormat ?? 'unknown'}; baseline is ${expected.pixelFormats.join('/')}`));
    }
  }

  if (m.audio && (!m.audio.codec || !expected.audioCodecs.includes(m.audio.codec))) {
    flags.push(makeFlag('unexpected_audio_codec', `audio codec is ${m.audio.codec ?? 'unknown'}; baseline is ${expected.audioCodecs.join('/')}`));
  }
  return flags;
}
