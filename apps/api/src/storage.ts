import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { fileTypeFromBuffer, fileTypeFromFile, type FileTypeResult } from "file-type";

export interface StorageProvider {
  save(file: MultipartFile): Promise<{ path: string; size: number; sha256: string }>;
  remove(storedPath: string): Promise<void>;
  publicUrl(storedPath: string): string;
}

export class InvalidMediaError extends Error { statusCode = 415; }
export const mediaExtensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav" };
const videoMimeByExtension: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
export function resolveUploadMime(mime: string, filename: string) {
  const normalized = mime.split(";", 1)[0]!.trim().toLowerCase();
  if (normalized === "video/x-quicktime") return "video/quicktime";
  if (normalized === "video/x-m4v" || normalized === "application/mp4") return "video/mp4";
  // Browsers may omit the MIME for MOV or send a generic binary type. The
  // extension only selects a candidate; save() must still verify its contents.
  if (["", "application/octet-stream", "binary/octet-stream", "text/plain"].includes(normalized)) {
    return videoMimeByExtension[path.extname(filename).toLowerCase()] ?? normalized;
  }
  return normalized;
}
async function validVideo(mime: string, detect: () => Promise<FileTypeResult | undefined>) {
  try {
    const detected = await detect();
    // QuickTime and MP4 share ISO-BMFF; exporters can use either set of brands.
    const bmff = ["video/mp4", "video/quicktime"];
    return detected?.mime === mime || (bmff.includes(mime) && bmff.includes(detected?.mime ?? ""));
  } catch (error) {
    if (error instanceof RangeError || (error instanceof Error && error.name === "EndOfStreamError")) return false;
    throw error;
  }
}
export async function validMagic(mime: string, b: Buffer) {
  if (mime.startsWith("video/")) return validVideo(mime, () => fileTypeFromBuffer(b));
  const text = (start: number, end: number) => b.toString("ascii", start, end);
  switch (mime) {
    case "image/png": return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg": return b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    case "image/gif": return ["GIF87a", "GIF89a"].includes(text(0, 6));
    case "image/webp": return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
    case "audio/wav": return text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
    case "audio/ogg": return text(0, 4) === "OggS";
    case "audio/mpeg": return text(0, 3) === "ID3" || (b.length >= 4 && b[0] === 255 && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 6) !== 0 && (b[2]! & 0xf0) !== 0xf0 && (b[2]! & 12) !== 12);
    default: return false;
  }
}

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}
  async init() { await mkdir(this.root, { recursive: true }); }
  async save(file: MultipartFile) {
    const mime = resolveUploadMime(file.mimetype, file.filename);
    const extension = Object.hasOwn(mediaExtensions, mime) ? mediaExtensions[mime] : undefined;
    if (!extension) { file.file.resume(); throw new InvalidMediaError("Unsupported file type"); }
    const target = path.join(this.root, `${randomUUID()}${extension}`);
    const hash = createHash("sha256");
    let size = 0;
    let header = Buffer.alloc(0);
    const inspect = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (header.length < 4096) header = Buffer.concat([header, chunk.subarray(0, 4096 - header.length)]);
      hash.update(chunk); callback(null, chunk);
    } });
    try {
      await pipeline(file.file, inspect, createWriteStream(target, { flags: "wx" }));
      if (file.file.truncated) throw Object.assign(new Error("File too large"), { statusCode: 413 });
      // Read video metadata from the file, not only the first 4 KiB: a MOV can
      // start with padding or keep its moov atom after a large mdat atom.
      const valid = mime.startsWith("video/") ? await validVideo(mime, () => fileTypeFromFile(target)) : await validMagic(mime, header);
      if (!valid) throw new InvalidMediaError("File content does not match media type");
      return { path: target, size, sha256: hash.digest("hex") };
    } catch (error) { await this.remove(target); throw error; }
  }
  async remove(storedPath: string) {
    if (path.dirname(path.resolve(storedPath)) !== path.resolve(this.root)) throw new Error("Invalid stored path");
    await rm(storedPath, { force: true });
  }
  publicUrl(storedPath: string) { return `/assets/${path.basename(storedPath)}`; }
}
