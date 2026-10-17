/** Check ZIP metadata before the browser asks Mammoth to inflate a DOCX archive. */
export function validateDocxArchive(buffer: ArrayBuffer): void {
  const bytes = new DataView(buffer);
  let end = -1;
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65_557); offset -= 1) {
    if (bytes.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("This is not a readable DOCX archive.");
  const files = bytes.getUint16(end + 10, true);
  const directory = bytes.getUint32(end + 16, true);
  if (files === 0xffff || directory === 0xffffffff || files > 2000 || bytes.getUint16(end + 4, true) !== 0 || bytes.getUint16(end + 6, true) !== 0) throw new Error("This DOCX archive is too complex. Export the relevant pages as PDF or text.");
  let cursor = directory;
  let expanded = 0;
  let foundDocument = false;
  for (let index = 0; index < files; index += 1) {
    if (cursor + 46 > end || bytes.getUint32(cursor, true) !== 0x02014b50) throw new Error("The DOCX archive has an invalid directory.");
    const flags = bytes.getUint16(cursor + 8, true);
    const uncompressed = bytes.getUint32(cursor + 24, true);
    const nameLength = bytes.getUint16(cursor + 28, true);
    const extraLength = bytes.getUint16(cursor + 30, true);
    const commentLength = bytes.getUint16(cursor + 32, true);
    if (flags & 1 || uncompressed === 0xffffffff || uncompressed > 20 * 1024 * 1024) throw new Error("Encrypted or oversized DOCX entries are not supported. Paste the text instead.");
    expanded += uncompressed;
    if (expanded > 50 * 1024 * 1024 || cursor + 46 + nameLength + extraLength + commentLength > end) throw new Error("The expanded DOCX exceeds the 50 MB safety limit.");
    const name = new TextDecoder().decode(new Uint8Array(buffer, cursor + 46, nameLength));
    if (name === "word/document.xml") foundDocument = true;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!foundDocument) throw new Error("The upload does not contain a Word document.");
}
