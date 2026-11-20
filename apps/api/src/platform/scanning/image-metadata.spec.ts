import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { stripImageMetadata } from "./image-metadata.js";

const GPS = "GPSLatitude=-33.9249;GPSLongitude=18.4241";

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function sampleJpeg(withMetadata: boolean): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...(withMetadata
      ? [
          jpegSegment(0xe1, Buffer.from(`Exif\0\0${GPS}`, "latin1")),
          jpegSegment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>", "latin1")),
          jpegSegment(0xed, Buffer.from("Photoshop 3.0\0IPTC", "latin1")),
          jpegSegment(0xfe, Buffer.from("taken at home", "latin1")),
        ]
      : []),
    jpegSegment(0xdb, Buffer.alloc(65, 1)), // quantisation table
    jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]), // entropy-coded data
    Buffer.from([0xff, 0xd9]),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function samplePng(withMetadata: boolean): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    ...(withMetadata
      ? [
          pngChunk("eXIf", Buffer.from(GPS, "latin1")),
          pngChunk("tEXt", Buffer.from(`Comment\0${GPS}`, "latin1")),
          pngChunk("tIME", Buffer.from([7, 234, 11, 19, 12, 0, 0])),
        ]
      : []),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, "latin1");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function sampleWebp(): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c; // EXIF + XMP flags
  const body = Buffer.concat([
    webpChunk("VP8X", vp8x),
    webpChunk("VP8 ", Buffer.alloc(11, 2)),
    webpChunk("EXIF", Buffer.from(GPS, "latin1")),
    webpChunk("XMP ", Buffer.from("<x:xmpmeta/>", "latin1")),
  ]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, body]);
}

describe("stripImageMetadata", () => {
  it("removes EXIF, XMP, IPTC and comments from JPEGs and keeps the image data", () => {
    const stripped = stripImageMetadata(sampleJpeg(true), "image/jpeg");
    expect(stripped.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(stripped.includes(Buffer.from("xmpmeta"))).toBe(false);
    expect(stripped.includes(Buffer.from("taken at home"))).toBe(false);
    expect(stripped.equals(sampleJpeg(false))).toBe(true);
  });

  it("removes eXIf, text and time chunks from PNGs, leaving valid chunks", () => {
    const stripped = stripImageMetadata(samplePng(true), "image/png");
    expect(stripped.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(stripped.equals(samplePng(false))).toBe(true);
  });

  it("removes EXIF and XMP chunks from WebP and clears their header flags", () => {
    const stripped = stripImageMetadata(sampleWebp(), "image/webp");
    expect(stripped.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(stripped.includes(Buffer.from("xmpmeta"))).toBe(false);
    expect(stripped.readUInt32LE(4)).toBe(stripped.length - 8); // RIFF size updated
    expect((stripped[20] ?? 0) & 0x0c).toBe(0); // VP8X flags cleared
    expect(stripped.includes(Buffer.from("VP8 "))).toBe(true);
  });

  it("refuses malformed files instead of passing them through", () => {
    const truncated = sampleJpeg(true).subarray(0, 30);
    expect(() => stripImageMetadata(truncated, "image/jpeg")).toThrow();
    expect(() => stripImageMetadata(samplePng(true).subarray(0, 40), "image/png")).toThrow();
    expect(() => stripImageMetadata(Buffer.from("%PDF-1.4"), "image/png")).toThrow();
    expect(() => stripImageMetadata(sampleJpeg(false), "image/gif")).toThrow(/unsupported/);
  });
});
