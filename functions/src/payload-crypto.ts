import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Encryption at rest for CACHED PARTICIPANT PAYLOADS -- the Cloud Storage
// objects under pending-data/ (persist-pending.ts) and upload-queue/
// (queue-upload.ts, scheduled-pending-recovery.ts). Those are the only copies
// of a participant's submission that DataPipe itself holds, for up to seven
// days, and the FAQ tells researchers they are encrypted at rest. Until this
// module existed they were written as plaintext.
//
// This is deliberately a SEPARATE module from crypto-utils.ts rather than a
// reuse of it. crypto-utils encrypts short secrets (provider tokens) as
// strings, into a base64 `v1:iv:ct:tag` form that is stored in a Firestore
// FIELD. Payloads are megabyte-scale, arbitrary bytes, stored as whole
// storage OBJECTS, and must interoperate with objects written before this
// shipped. Same cipher, same secret, different envelope.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// ---------------------------------------------------------------------------
// The format marker
// ---------------------------------------------------------------------------
//
// Objects written before this module shipped are plaintext and must stay
// readable for their full 7-day retention (there is no migration job -- they
// age out through the existing cleanup sweeps). So every read is
// decrypt-if-marked / passthrough-if-legacy, and the marker has to be one that
// CANNOT false-positive on a legacy object.
//
// The marker is a binary magic header on the blob itself, NOT custom object
// metadata, and it starts with 0xFF 0x00. That first byte is the whole
// argument:
//
//   Every legacy pending/queue object was written by `file.save(<JS string>)`,
//   i.e. it is the UTF-8 encoding of a JavaScript string. UTF-8 output NEVER
//   contains the byte 0xFF (nor 0xFE) in any position -- not for astral
//   characters, not for lone surrogates (which encode as EF BF BD). So no
//   legacy object can begin with this header. Not "unlikely to": cannot.
//
// That is the property a printable prefix like "DPENC1" would NOT have.
// Participant payloads are researcher-controlled bytes -- a jsPsych trial's
// `response` field is whatever the participant typed -- so a guessable ASCII
// prefix is something a researcher could put at the start of a submission,
// which would send a plaintext object down the decrypt path and fail a read
// that must succeed.
//
// Object custom metadata (x-goog-meta-*) would also be unforgeable by payload
// bytes, and was the other candidate. The header wins on three counts: it
// costs no extra round trip (`file.download()` returns bytes but not custom
// metadata, so every read path would need a second getMetadata() call); it
// travels with the bytes, so a copy/rewrite that drops metadata cannot turn a
// ciphertext into an "unencrypted" object; and it makes the blob
// self-describing for anyone inspecting the bucket by hand.
const MAGIC = Buffer.from([0xff, 0x00, 0x44, 0x50, 0x45, 0x4e, 0x43]); // \xFF\x00 "DPENC"
const FORMAT_VERSION = 0x01;

// MAGIC(7) | VERSION(1) | IV(12) | TAG(16) | ciphertext...
//
// The GCM tag lives in the fixed-size header rather than being appended, so a
// future streaming reader can setAuthTag() from the first 36 bytes and pipe
// the rest through a decipher without buffering to find a trailing tag. (No
// read path streams today -- see the note on buffering at the bottom of this
// file -- but the format should not be what prevents it.)
const VERSION_OFFSET = MAGIC.length;
const IV_OFFSET = VERSION_OFFSET + 1;
const TAG_OFFSET = IV_OFFSET + IV_LENGTH;
const HEADER_LENGTH = TAG_OFFSET + TAG_LENGTH; // 36

// Encrypted blobs are binary. Writing them with the old "application/json" /
// "text/plain" content types would be a lie told to anything that inspects the
// bucket. Nothing in DataPipe reads the stored content type -- api-queue-status
// derives the researcher-facing Content-Type from the filename extension -- so
// this is free to be honest.
export const ENCRYPTED_CONTENT_TYPE = "application/octet-stream";

/**
 * Raised when a blob carries the marker but cannot be authenticated: a rotated
 * key, a truncated object, corruption. Distinct from every other read failure
 * so callers can route it deliberately -- see scheduled-upload-retry.ts (marks
 * the queue entry permanently failed) and scheduled-pending-recovery.ts (which
 * must NOT do what it does for a corrupt envelope, i.e. delete the file).
 */
export class PayloadDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadDecryptionError";
  }
}

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------
//
// Derived from TOKEN_ENCRYPTION_KEY -- the secret that already reaches every
// function -- via HKDF-SHA256 with a fixed, payload-specific info label.
//
// Why derive rather than add a PAYLOAD_ENCRYPTION_KEY env var: TOKEN_ENCRYPTION_KEY
// is a plain .env value written by .github/workflows/firebase-deploy*.yml from
// a repo secret, not a Firebase Secret bound per-function, so it is already in
// process.env everywhere with no `secrets: [...]` declarations to maintain. A
// second variable would mean a new repo secret, edits to three workflow files,
// and a deploy window in which functions that write payloads exist but the
// secret does not -- and getKey() throwing on the persist path is an HTTP 500
// on a live participant's submission.
//
// Why derive rather than use TOKEN_ENCRYPTION_KEY directly: domain separation
// costs one hkdfSync call. The token key and the payload key are then
// independent, so a payload ciphertext and a token ciphertext can never be
// decrypted with each other's key material even though they share a cipher and
// a source secret.
//
// Operational consequence, stated plainly: rotating TOKEN_ENCRYPTION_KEY now
// invalidates in-flight cached payloads as well as stored provider tokens.
// That is not silent -- it surfaces as a queue failure with an explicit
// reason. See PayloadDecryptionError's callers.
const HKDF_SALT = Buffer.from("datapipe-payload-crypto", "utf8");
const HKDF_INFO = Buffer.from("datapipe:pending-payload:v1", "utf8");

// Read lazily on every call, exactly as crypto-utils.ts's getKey() does: the
// emulator test suites set process.env.TOKEN_ENCRYPTION_KEY after module load,
// and one of them rotates it mid-run to prove the failure path.
function getPayloadKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(hex, "hex"), HKDF_SALT, HKDF_INFO, 32)
  );
}

// Magic alone means "this object is ours", regardless of whether the rest of
// the header is intact. Kept separate from isEncryptedPayload so decryptPayload
// can tell a LEGACY object (no magic -> pass through) apart from a DAMAGED one
// (magic, but truncated or a version we don't know -> fail loudly). Passing a
// damaged ciphertext through as though it were plaintext would be a silent
// corruption, which is the outcome this whole module exists to avoid.
function hasMagic(blob: Buffer): boolean {
  return (
    blob.length >= MAGIC.length && blob.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

/**
 * True if `blob` is a complete, known-version encrypted payload. A legacy
 * plaintext object can never satisfy this (see the MAGIC comment above).
 */
export function isEncryptedPayload(blob: Buffer): boolean {
  return (
    hasMagic(blob) &&
    blob.length >= HEADER_LENGTH &&
    blob[VERSION_OFFSET] === FORMAT_VERSION
  );
}

/**
 * Encrypt a payload for storage. Accepts the string every call site already
 * has in hand (avoiding one intermediate Buffer) or raw bytes.
 */
export function encryptPayload(plaintext: string | Buffer): Buffer {
  const key = getPayloadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const body =
    typeof plaintext === "string"
      ? cipher.update(plaintext, "utf8")
      : cipher.update(plaintext);
  // GCM is a stream cipher, so this is empty in practice -- but do not encode
  // that assumption.
  const tail = cipher.final();
  const tag = cipher.getAuthTag();

  const header = Buffer.allocUnsafe(HEADER_LENGTH);
  MAGIC.copy(header, 0);
  header[VERSION_OFFSET] = FORMAT_VERSION;
  iv.copy(header, IV_OFFSET);
  tag.copy(header, TAG_OFFSET);

  // A single concat: peak memory is the plaintext plus one copy of the
  // ciphertext, which is what `file.save(<string>)` already costs on its own
  // (it buffers the string to UTF-8 internally).
  return Buffer.concat(
    [header, body, tail],
    HEADER_LENGTH + body.length + tail.length
  );
}

/**
 * Decrypt a stored payload.
 *
 * An unmarked blob is returned UNCHANGED -- that is the backward-compatibility
 * contract for objects written before this shipped, which must stay readable
 * for their full 7-day retention.
 *
 * A MARKED blob that will not authenticate throws PayloadDecryptionError. It
 * is never returned as-is: handing a caller ciphertext it believes is
 * participant data is the one outcome worse than failing.
 *
 * MEMORY PROFILE: Buffer in, Buffer out, deliberately. Every pending/queue
 * read path already buffers the whole object (`file.download()` in
 * scheduled-upload-retry.ts, api-queue-status.ts, persist-pending.ts) and
 * every write path already buffers the whole payload (`file.save(<string>)`).
 * Only finalization.ts and compaction.ts stream, and those handle merged
 * provider archives rather than these objects. Matching the existing profile
 * keeps this change to the cipher; converting these paths to streams is a
 * separate, larger piece of work.
 */
export function decryptPayload(blob: Buffer): Buffer {
  if (!isEncryptedPayload(blob)) {
    if (hasMagic(blob)) {
      // Ours, but unusable: truncated below the 36-byte header, or written by
      // a format version this build does not know. Either way it is not
      // participant plaintext and must not be handed back as if it were.
      throw new PayloadDecryptionError(
        "The stored copy of this submission is marked as encrypted but its " +
          "header is truncated or uses an unsupported format version"
      );
    }
    return blob;
  }

  const iv = blob.subarray(IV_OFFSET, IV_OFFSET + IV_LENGTH);
  const tag = blob.subarray(TAG_OFFSET, TAG_OFFSET + TAG_LENGTH);
  const ciphertext = blob.subarray(HEADER_LENGTH);

  try {
    const decipher = createDecipheriv(ALGORITHM, getPayloadKey(), iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    const body = decipher.update(ciphertext);
    const tail = decipher.final();
    return tail.length ? Buffer.concat([body, tail]) : body;
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error";
    // getPayloadKey() is called INSIDE the try on purpose, so an absent or
    // malformed TOKEN_ENCRYPTION_KEY also surfaces as a PayloadDecryptionError.
    // From a reader's point of view "I cannot decrypt this" is equally true
    // whether the key is wrong or missing, and the callers' handling for it --
    // scheduled-pending-recovery.ts in particular, which must NOT delete what
    // it cannot read -- is what you want in both cases.
    throw new PayloadDecryptionError(
      "The stored copy of this submission could not be decrypted " +
        "(the encryption key may have been rotated or be unavailable, or the " +
        `stored object may be damaged): ${detail}`
    );
  }
}
