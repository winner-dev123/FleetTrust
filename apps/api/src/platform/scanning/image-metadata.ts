/**
 * Removes embedded metadata from public images (ADR-0006: EXIF stripping before release).
 * Photos from phones carry GPS coordinates, device serials and timestamps in EXIF/XMP/IPTC;
 * a provider's gallery must not leak where a photo was taken. Pixel data is untouched.
 *
 * Throws on malformed files rather than passing them through unstripped.
 */
export function stripImageMetadata(data: Buffer, contentType: string): Buffer {
  switch (contentType) {
    case "image/jpeg":
      return stripJpeg(data);
    case "image/png":
      return stripPng(data);
    case "image/webp":
      return stripWebp(data);
    default:
      throw new Error(`unsupported image type: ${contentType}`);
  }
}

/** JPEG: drop APP1 (EXIF/XMP), APP12–APP15 (vendor/Adobe/IPTC) and COM segments. Keep APP0 (JFIF), APP2 (ICC). */
function stripJpeg(data: Buffer): Buffer {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error("not a JPEG");
  const kept: Buffer[] = [data.subarray(0, 2)];
  let offset = 2;
  while (offset < data.length) {
    if (data[offset] !== 0xff) throw new Error("malformed JPEG segment");
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded image data (and EOI).
      kept.push(data.subarray(offset));
      return Buffer.concat(kept);
    }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > data.length) throw new Error("truncated JPEG");
    const length = data.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > data.length) throw new Error("truncated JPEG segment");
    const drop = marker === 0xe1 || (marker >= 0xec && marker <= 0xef) || marker === 0xfe;
    if (!drop) kept.push(data.subarray(offset, end));
    offset = end;
  }
  throw new Error("JPEG without image data");
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

/** PNG: drop eXIf and the text/time chunks. CRCs of kept chunks are unchanged. */
function stripPng(data: Buffer): Buffer {
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  const kept: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  while (offset < data.length) {
    if (offset + 12 > data.length) throw new Error("truncated PNG chunk");
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("latin1");
    const end = offset + 12 + length;
    if (end > data.length) throw new Error("truncated PNG chunk");
    if (!PNG_METADATA_CHUNKS.has(type)) kept.push(data.subarray(offset, end));
    offset = end;
    if (type === "IEND") return Buffer.concat(kept);
  }
  throw new Error("PNG without IEND");
}

/** WebP: drop EXIF and XMP chunks, and clear their flags in the VP8X header. */
function stripWebp(data: Buffer): Buffer {
  if (
    data.subarray(0, 4).toString("latin1") !== "RIFF" ||
    data.subarray(8, 12).toString("latin1") !== "WEBP"
  ) {
    throw new Error("not a WebP");
  }
  const kept: Buffer[] = [];
  let offset = 12;
  while (offset < data.length) {
    if (offset + 8 > data.length) throw new Error("truncated WebP chunk");
    const type = data.subarray(offset, offset + 4).toString("latin1");
    const size = data.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2); // chunks are padded to even sizes
    if (end > data.length) throw new Error("truncated WebP chunk");
    if (type === "VP8X") {
      const chunk = Buffer.from(data.subarray(offset, end));
      chunk[8] = (chunk[8] ?? 0) & ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
      kept.push(chunk);
    } else if (type !== "EXIF" && type !== "XMP ") {
      kept.push(data.subarray(offset, end));
    }
    offset = end;
  }
  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}
