/**
 * Captures one still frame from a live <video> element.
 *
 * PRIVACY: the result is an in-memory Blob returned to the caller. This module
 * performs no network requests, no storage writes and no logging.
 *
 * The image is NOT mirrored, even if the preview is. Pose models and later
 * comparisons expect the true left/right of the person.
 */

import type { NewScanPhoto } from '../types/bodyScan';

export type FrameCaptureErrorCode = 'not_ready' | 'canvas_unavailable' | 'encode_failed';

export class FrameCaptureError extends Error {
  readonly code: FrameCaptureErrorCode;
  constructor(code: FrameCaptureErrorCode, message: string) {
    super(message);
    this.name = 'FrameCaptureError';
    this.code = code;
  }
}

export interface FrameCaptureOptions {
  /** Longest side of the output in px; larger frames are scaled down. Default 1920. */
  maxDimension?: number;
  /** JPEG quality 0..1. Default 0.92. */
  quality?: number;
}

export const DEFAULT_MAX_DIMENSION = 1920;
export const DEFAULT_JPEG_QUALITY = 0.92;
const MIME_TYPE = 'image/jpeg';

/** Output size for a source frame, preserving aspect ratio and never upscaling. Returns null for invalid input. */
export function fitWithin(width: number, height: number, maxDimension: number): { width: number; height: number } | null {
  if (![width, height, maxDimension].every((n) => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Takes a still of the video's current frame. Rejects with FrameCaptureError; never returns a placeholder image. */
export function captureFrame(
  video: HTMLVideoElement,
  view: NewScanPhoto['view'],
  options: FrameCaptureOptions = {}
): Promise<NewScanPhoto> {
  const size = fitWithin(video.videoWidth, video.videoHeight, options.maxDimension ?? DEFAULT_MAX_DIMENSION);
  if (!size || video.readyState < 2 /* HAVE_CURRENT_DATA */) {
    return Promise.reject(new FrameCaptureError('not_ready', 'The camera preview is not ready yet.'));
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new FrameCaptureError('canvas_unavailable', 'This browser could not prepare the photo.'));
  }
  // Release the pixel buffer promptly; any resulting Blob holds its own copy.
  const releaseCanvas = () => {
    canvas.width = 0;
    canvas.height = 0;
  };
  const encodeFailed = () => new FrameCaptureError('encode_failed', 'The photo could not be created. Please try again.');

  // drawImage can throw (e.g. a video that lost its frame). Report it as a rejection, never as a synchronous throw.
  try {
    ctx.drawImage(video, 0, 0, size.width, size.height);
  } catch {
    releaseCanvas();
    return Promise.reject(encodeFailed());
  }

  return new Promise<NewScanPhoto>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          releaseCanvas();
          if (!blob) {
            reject(encodeFailed());
            return;
          }
          resolve({ view, blob, mimeType: blob.type || MIME_TYPE, width: size.width, height: size.height });
        },
        MIME_TYPE,
        options.quality ?? DEFAULT_JPEG_QUALITY
      );
    } catch {
      releaseCanvas();
      reject(encodeFailed());
    }
  });
}
