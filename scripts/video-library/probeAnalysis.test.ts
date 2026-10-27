// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateMeasurement, EXPECTED_MEDIA, FLAG_SEVERITY, parseFfprobeJson, ProbeParseError, type FlagCode } from './probeAnalysis';

type J = Record<string, unknown>;
const video = (o: J = {}) => ({ codec_type: 'video', codec_name: 'h264', profile: 'High', level: 31, pix_fmt: 'yuv420p', width: 1280, height: 720, duration: '1.000000', disposition: { attached_pic: 0 }, ...o });
const audio = (o: J = {}) => ({ codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '44100', channels: 2, disposition: { attached_pic: 0 }, ...o });
const file = (o: { format?: J | null; streams?: J[] } = {}) => ({
  format: o.format === null ? undefined : { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1.000000', tags: { major_brand: 'isom' }, ...(o.format ?? {}) },
  streams: o.streams ?? [video(), audio()]
});
const measure = (o?: Parameters<typeof file>[0]) => parseFfprobeJson(JSON.stringify(file(o)));
const codes = (o?: Parameters<typeof file>[0]) => evaluateMeasurement(measure(o)).map((f) => f.code);

describe('parseFfprobeJson', () => {
  it('extracts container, brand, duration, codecs, profile, pixel format and dimensions', () => {
    expect(measure()).toEqual({
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      majorBrand: 'isom',
      durationSeconds: 1,
      video: { codec: 'h264', profile: 'High', level: 31, pixelFormat: 'yuv420p', width: 1280, height: 720, rotation: null },
      videoStreamCount: 1,
      audio: { codec: 'aac', profile: 'LC', sampleRate: 44100, channels: 2 },
      audioStreamCount: 1
    });
  });

  it('treats "N/A" and missing values as null, and keeps zero/negative durations so they can be reported', () => {
    expect(measure({ format: { duration: 'N/A' }, streams: [video({ duration: 'N/A' })] }).durationSeconds).toBeNull();
    expect(measure({ format: { duration: undefined }, streams: [video({ duration: undefined })] }).durationSeconds).toBeNull();
    expect(measure({ format: { duration: '0.000000' } }).durationSeconds).toBe(0);
    expect(measure({ format: { duration: '-2.5' } }).durationSeconds).toBe(-2.5);
    expect(measure({ format: { duration: 'abc' }, streams: [video({ duration: undefined })] }).durationSeconds).toBeNull();
  });

  it('falls back to the video stream duration when the container has none', () => {
    expect(measure({ format: { duration: 'N/A' }, streams: [video({ duration: '2.5' })] }).durationSeconds).toBe(2.5);
  });

  it('lowercases codec and pixel format names', () => {
    const m = measure({ streams: [video({ codec_name: 'H264', pix_fmt: 'YUV420P' })] });
    expect(m.video).toMatchObject({ codec: 'h264', pixelFormat: 'yuv420p' });
  });

  it('picks the first real video stream and ignores cover art, counting only real streams', () => {
    const cover = video({ codec_name: 'mjpeg', pix_fmt: 'yuvj420p', disposition: { attached_pic: 1 } });
    const m = measure({ streams: [cover, video({ width: 640, height: 360 }), video({ codec_name: 'hevc' }), audio()] });
    expect(m.video).toMatchObject({ codec: 'h264', width: 640, height: 360 });
    expect(m.videoStreamCount).toBe(2);
    expect(measure({ streams: [cover, audio()] }).video).toBeNull();
  });

  it('reads display rotation from side data or the legacy rotate tag', () => {
    expect(measure({ streams: [video({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] })] }).video?.rotation).toBe(-90);
    expect(measure({ streams: [video({ tags: { rotate: '90' } })] }).video?.rotation).toBe(90);
  });

  it('reports no audio as null (a silent video is normal)', () => {
    const m = measure({ streams: [video()] });
    expect(m.audio).toBeNull();
    expect(m.audioStreamCount).toBe(0);
  });

  it('rejects output that is not usable ffprobe JSON', () => {
    for (const bad of ['', 'not json', '[]', '"x"', 'null', '{}', '{"streams":[],"format":null}']) {
      expect(() => parseFfprobeJson(bad), bad).toThrow(ProbeParseError);
    }
  });
});

describe('evaluateMeasurement: the baseline is H.264 / yuv420p / AAC', () => {
  it('flags nothing for a good file, with or without audio', () => {
    expect(codes()).toEqual([]);
    expect(codes({ streams: [video()] })).toEqual([]);
  });

  it('flags a missing video stream (audio-only, empty, or cover art only)', () => {
    expect(codes({ streams: [audio()] })).toContain('no_video_stream');
    expect(codes({ streams: [] })).toContain('no_video_stream');
    expect(codes({ streams: [video({ disposition: { attached_pic: 1 } })] })).toContain('no_video_stream');
    expect(evaluateMeasurement(measure({ streams: [audio()] })).find((f) => f.code === 'no_video_stream')?.detail).toContain('audio but no video');
  });

  it('flags unexpected video codecs and pixel formats', () => {
    expect(codes({ streams: [video({ codec_name: 'hevc' })] })).toEqual(['unexpected_video_codec']);
    expect(codes({ streams: [video({ codec_name: 'vp9' })] })).toEqual(['unexpected_video_codec']);
    expect(codes({ streams: [video({ pix_fmt: 'yuv444p' })] })).toEqual(['unexpected_pixel_format']);
    expect(codes({ streams: [video({ pix_fmt: 'yuv420p10le' })] })).toEqual(['unexpected_pixel_format']);
    expect(codes({ streams: [video({ pix_fmt: 'yuvj420p' })] })).toEqual(['unexpected_pixel_format']);
    expect(codes({ streams: [video({ codec_name: 'hevc', pix_fmt: 'yuv444p' })] })).toEqual(['unexpected_video_codec', 'unexpected_pixel_format']);
  });

  it('flags missing codec or pixel format names as unexpected', () => {
    expect(codes({ streams: [video({ codec_name: undefined, pix_fmt: undefined })] })).toEqual(['unexpected_video_codec', 'unexpected_pixel_format']);
  });

  it('flags an unexpected audio codec only when audio is present', () => {
    expect(codes({ streams: [video(), audio({ codec_name: 'opus' })] })).toEqual(['unexpected_audio_codec']);
    expect(codes({ streams: [video(), audio({ codec_name: 'mp3' })] })).toEqual(['unexpected_audio_codec']);
    expect(codes({ streams: [video()] })).toEqual([]);
  });

  it('flags invalid durations: missing, zero, negative', () => {
    for (const d of [{ duration: 'N/A' }, { duration: '0' }, { duration: '-1' }]) {
      expect(codes({ format: d, streams: [video({ duration: undefined }), audio()] }), JSON.stringify(d)).toEqual(['invalid_duration']);
    }
    expect(evaluateMeasurement(measure({ format: { duration: '0' } }))[0].detail).toContain('0 seconds');
  });

  it('flags invalid dimensions', () => {
    expect(codes({ streams: [video({ width: 0, height: 0 })] })).toEqual(['invalid_dimensions']);
    expect(codes({ streams: [video({ width: undefined })] })).toEqual(['invalid_dimensions']);
    expect(codes({ streams: [video({ width: -4 })] })).toEqual(['invalid_dimensions']);
  });

  it('reports several problems together and gives every flag its severity', () => {
    const flags = evaluateMeasurement(measure({ format: { duration: 'N/A' }, streams: [audio({ codec_name: 'opus' })] }));
    expect(flags.map((f) => f.code).sort()).toEqual(['invalid_duration', 'no_video_stream', 'unexpected_audio_codec']);
    for (const f of flags) expect(f.severity).toBe(FLAG_SEVERITY[f.code as FlagCode]);
    expect(FLAG_SEVERITY.no_video_stream).toBe('error');
    expect(FLAG_SEVERITY.unexpected_video_codec).toBe('warning');
  });

  it('honours a different expectation set', () => {
    const m = measure({ streams: [video({ codec_name: 'hevc' })] });
    expect(evaluateMeasurement(m, { ...EXPECTED_MEDIA, videoCodecs: ['h264', 'hevc'] })).toEqual([]);
  });
});
