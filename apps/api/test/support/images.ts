import { crc32 } from "node:zlib";

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** A tiny valid PNG, optionally carrying GPS metadata in eXIf and tEXt chunks. */
export function samplePng(metadata?: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    ...(metadata === undefined
      ? []
      : [
          pngChunk("eXIf", Buffer.from(metadata, "latin1")),
          pngChunk("tEXt", Buffer.from(`Comment\0${metadata}`, "latin1")),
        ]),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
