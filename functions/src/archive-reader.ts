// Reads a zip built by buildArchive (compaction.ts) back into its member
// paths and bytes -- the inverse operation, and Phase 3's way of re-emitting a
// batch archive's contents into a merged finalization archive without ever
// materializing the intermediate batch on disk unzipped.
//
// WHY THE CENTRAL DIRECTORY, NOT THE LOCAL FILE HEADERS: archiver streams its
// output rather than seeking back to patch headers once a member's true size
// is known, so it sets the "data descriptor follows" bit in the general
// purpose flag and writes zeroed crc32/compressed/uncompressed sizes into
// each local file header; the real values only show up in a data descriptor
// trailer after the member's bytes, and in the central directory at the end
// of the archive. Reading local headers naively -- as if this were a
// non-streamed zip -- would see size 0 for every member and either read
// nothing or misalign into the next entry. The central directory carries true
// sizes unconditionally, so it is the only part of the format this can trust.
// (buildArchive's own zlib level 9 does not change any of this: the streaming
// bit is about not knowing sizes in advance, independent of compression.)

import { inflateRawSync, crc32 } from "zlib";

// zlib.crc32 was added in Node 22.2.0 (verified against the installed
// runtime, not assumed). Firebase Functions here run Node 22
// (functions/package.json engines.node), so it's available, but confirming
// this on module load rather than hoping is cheap and turns a silent
// "content mismatches every archive" failure on an older runtime into a
// startup error that says what's actually wrong.
if (typeof crc32 !== "function") {
  throw new Error(
    "archive-reader.ts requires zlib.crc32 (Node >= 22.2.0) to verify member integrity before " +
      "callers delete the originals; the running Node version does not provide it"
  );
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

// End-of-central-directory record is fixed-size (22 bytes) plus a variable
// comment; scanning stops as soon as one is found, so a comment that happens
// to contain the signature bytes could in principle confuse this, but that is
// the same limitation every zip reader has and buildArchive never sets a
// comment.
const EOCD_MIN_SIZE = 22;

const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;

/**
 * Reads a byte range, throwing rather than returning a truncated/garbage
 * slice when the archive is too short to hold it. Buffer's own readUInt*
 * methods already throw out-of-range, but subarray does not, so anything read
 * from a computed offset needs this instead of a bare subarray call to avoid
 * silently returning a shorter-than-expected (or empty) result.
 */
function requireBytes(zip: Buffer, start: number, end: number, what: string): Buffer {
  if (start < 0 || end > zip.length || end < start) {
    throw new Error(
      `truncated archive: cannot read ${what} (bytes ${start}-${end}, archive is ${zip.length} bytes)`
    );
  }
  return zip.subarray(start, end);
}

/**
 * Locates the end-of-central-directory record by scanning backward from the
 * end of the buffer. Backward, not forward, because the only anchor a zip
 * offers is this record's fixed position relative to EOF -- everything else
 * is only reachable by first finding this.
 */
function findEndOfCentralDirectory(zip: Buffer): number {
  if (zip.length < EOCD_MIN_SIZE) {
    throw new Error(
      `truncated archive: ${zip.length} bytes is smaller than the minimum end-of-central-directory record (${EOCD_MIN_SIZE} bytes)`
    );
  }
  for (let i = zip.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return i;
    }
  }
  throw new Error("no end-of-central-directory record found: not a zip file, or the archive is corrupt");
}

/**
 * Parses a zip's central directory into a map of archive path to file
 * content. Local file headers are never consulted for sizes (see the module
 * comment); the local header is only used to find where a member's raw bytes
 * begin, which central-directory entries do carry as a byte offset but do not
 * carry the length of the local header preceding the data itself.
 */
export function readArchive(zip: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(zip);

  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = zip.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();
  let offset = centralDirectoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > zip.length) {
      throw new Error(
        `truncated archive: central directory entry ${i} of ${entryCount} starts at byte ${offset} but only ${zip.length} bytes are present`
      );
    }

    const signature = zip.readUInt32LE(offset);
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(
        `corrupt central directory: entry ${i} of ${entryCount} at byte ${offset} has signature ` +
          `0x${signature.toString(16).padStart(8, "0")}, expected 0x${CENTRAL_DIRECTORY_SIGNATURE.toString(16)}`
      );
    }

    const method = zip.readUInt16LE(offset + 10);
    const declaredCrc32 = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const declaredUncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);

    const nameBytes = requireBytes(zip, offset + 46, offset + 46 + nameLength, `entry ${i} filename`);
    const name = nameBytes.toString("utf8");

    // Jump to the local header purely to learn how long ITS name/extra fields
    // are -- they are not required to match the central directory's (in
    // practice they do for archiver's output, but nothing in the format
    // guarantees it), so the local header has to be read to find where the
    // member's raw bytes actually start.
    if (localHeaderOffset + 30 > zip.length) {
      throw new Error(
        `truncated archive: local file header for "${name}" starts at byte ${localHeaderOffset} but only ${zip.length} bytes are present`
      );
    }
    const localSignature = zip.readUInt32LE(localHeaderOffset);
    if (localSignature !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(
        `corrupt archive: local file header for "${name}" at byte ${localHeaderOffset} has signature ` +
          `0x${localSignature.toString(16).padStart(8, "0")}, expected 0x${LOCAL_FILE_HEADER_SIGNATURE.toString(16)}`
      );
    }
    const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const raw = requireBytes(zip, dataStart, dataStart + compressedSize, `data for "${name}"`);

    let content: Buffer;
    if (method === COMPRESSION_STORED) {
      // Copy rather than alias: raw is a subarray view into zip, and handing
      // that out would let a caller's mutation of the returned Buffer corrupt
      // the archive buffer underneath other entries still to be read.
      content = Buffer.from(raw);
    } else if (method === COMPRESSION_DEFLATE) {
      try {
        content = inflateRawSync(raw);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`failed to inflate "${name}" (deflate, method 8): ${reason}`);
      }
    } else {
      throw new Error(
        `unsupported compression method ${method} for entry "${name}": only 0 (stored) and 8 (deflate) are supported`
      );
    }

    // Verify BEFORE handing content back, not after: the caller this is built
    // for (Phase 3's finalization pass) re-emits this content into a merged
    // archive and then deletes the archive being read here, on the strength
    // of the MERGED archive's checksum alone. Nothing re-reads a batch
    // archive's own bytes to double-check them, so this is the only gate that
    // ever compares decoded content back against what the archive itself
    // claims. Size first because it's free (already have both numbers) and
    // catches gross truncation without spending a crc32 pass on data already
    // known to be wrong; crc32 catches the case size alone can't -- same
    // length, wrong bytes, which is exactly what a corrupted STORED entry
    // looks like, since STORED has no decode step of its own to fail on.
    if (content.length !== declaredUncompressedSize) {
      throw new Error(
        `size mismatch for "${name}": central directory declares ${declaredUncompressedSize} ` +
          `uncompressed bytes but decoding produced ${content.length} -- the archive is corrupt ` +
          `or was truncated after it was written`
      );
    }
    const actualCrc32 = crc32(content);
    if (actualCrc32 !== declaredCrc32) {
      throw new Error(
        `CRC-32 mismatch for "${name}": central directory declares ` +
          `0x${declaredCrc32.toString(16).padStart(8, "0")} but the decoded content hashes to ` +
          `0x${actualCrc32.toString(16).padStart(8, "0")} -- the archive is corrupt`
      );
    }

    entries.set(name, content);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
