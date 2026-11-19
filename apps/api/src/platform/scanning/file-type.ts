/**
 * Detects a file's real type from its first bytes (magic numbers). The declared Content-Type
 * is a client claim; a mismatch is rejected so, for example, an HTML file can't be stored as
 * a "PDF" and later rendered in a reviewer's browser.
 */
export function sniffContentType(data: Buffer): string | null {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString("latin1");
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  // ISO-BMFF: size(4) + "ftyp" + brand(4)
  if (
    ascii(4, 8) === "ftyp" &&
    ["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 12))
  ) {
    return "image/heic";
  }
  return null;
}
