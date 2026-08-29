import { onRequest } from "firebase-functions/v2/https";
import { randomInt, createHash } from "crypto";
import { db, auth } from "./app.js";
import { contactEmailRecipient, sendMail } from "./mail.js";
import { deliverMailDocument } from "./mail-delivery.js";
import { readMailStatus, verificationAvailability } from "./mail-availability.js";
import { ACCOUNT_URL } from "./email/upload-failure-copy.js";

// Send (or resend) a 6-digit code that confirms users/{uid}.contactEmail.
//
// Verification is confirmatory, never a gate (plan §2.2): a researcher has
// already satisfied the contact-email requirement the moment the address is
// a syntactically valid, non-synthetic string (lib/contact-email.js's
// hasContactEmail / this file's sibling mail.ts:contactEmailRecipient), and
// the upload-failure notifier mails that address regardless of verified
// state. This endpoint exists only so the account page can show "Confirmed"
// instead of "Not confirmed yet" -- nothing downstream reads the flag to
// decide whether to do anything.
//
// Auth shape copied from delete-account.ts / api-queue-status.ts exactly:
// method check, then `Authorization: Bearer <idToken>`, then
// auth.verifyIdToken. Unlike delete-account.ts this does not also need
// checkRevoked or a recent-login window -- mailing a code to an address the
// signed-in account already owns is not the kind of irreversible action that
// justifies the extra friction.
//
// The address that gets a code is always users/{uid}.contactEmail AS
// CURRENTLY STORED -- never a value the client could pass in the request
// body. Trusting a client-supplied address would let a signed-in researcher
// mint a "confirmed" flag for an address DataPipe doesn't actually have on
// file.

const CODE_DIGITS = 6;
const CODE_SPACE = 10 ** CODE_DIGITS; // 1_000_000 possible codes

// plan §2.2: "24-hour expiry, 5 attempts."
export const EXPIRY_MS = 24 * 60 * 60 * 1000;

// Floor between two ATTEMPTS to send to the same account. The plan does not pin
// a number beyond "rate-limited" and putting `sentAt` in the
// contactEmailVerifications schema for exactly this purpose; one minute is
// enough to stop a resend-mail-bomb loop (an impatient double-click, or
// someone hammering the endpoint) without making a researcher who mistyped
// and wants a fresh code wait anywhere near as long as the 24-hour code
// expiry itself.
//
// ATTEMPTS, not deliveries, and that distinction is the rate limit. This
// endpoint spends a real Resend request every time it gets past this check, so
// a path that reaches the send is a path that has to be throttled whatever the
// send then does. See the failure branch below, which used to delete the very
// record this reads.
export const RESEND_COOLDOWN_MS = 60 * 1000;

export const VERIFICATIONS_COLLECTION = "contactEmailVerifications";

export function verificationRef(uid: string): FirebaseFirestore.DocumentReference {
  return db.collection(VERIFICATIONS_COLLECTION).doc(uid);
}

// sha256 hex digest. Plain hashing, not crypto-utils.ts's AES encryption --
// the code is a one-time, short-lived, 6-digit secret that only ever needs
// to be COMPARED, never recovered, which is what a hash is for. Same
// primitive collision-cache.ts already uses for its salted filename hashes.
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Crypto-random, uniform over [0, 10^6) -- Math.random() has no place
// minting a secret. randomInt's upper bound is exclusive, matching
// CODE_SPACE exactly: "000000".."999999", all equally likely.
function generateCode(): string {
  return randomInt(0, CODE_SPACE).toString().padStart(CODE_DIGITS, "0");
}

// Binds the code to the uid that requested it, the same shape plan §2.2
// specifies (`codeHash: sha256(code + uid)`), so a hash leaked from one
// account's document cannot be replayed as a guess against another.
export function hashVerificationCode(code: string, uid: string): string {
  return sha256(`${code}${uid}`);
}

// Binds the code to the ADDRESS it was sent to, independent of the uid hash
// above -- this is the half of the record verify-contact-email.ts uses to
// refuse a stale code after the researcher has changed their address.
// `email` must already be normalized (contactEmailRecipient does this), so
// the same string hashed here is byte-identical to the one re-derived at
// verify time.
export function hashContactEmail(email: string): string {
  return sha256(email);
}

function buildVerificationEmail(code: string) {
  const subject = "Your DataPipe verification code";
  const text = [
    `Your DataPipe verification code is ${code}.`,
    "Enter it on your account page to confirm this address. The code expires in 24 hours.",
    "",
    `If you did not request this, you can ignore it -- nothing changes until the code is entered. Manage your address: ${ACCOUNT_URL}`,
  ].join("\n\n");
  const html = [
    `<p>Your DataPipe verification code is <strong style="font-size:1.2em;letter-spacing:0.1em">${code}</strong>.</p>`,
    "<p>Enter it on your account page to confirm this address. The code expires in 24 hours.</p>",
    `<p style="font-size:0.9em;color:#555">If you did not request this, you can ignore it -- nothing changes until the code is entered. <a href="${ACCOUNT_URL}">Manage your address</a>.</p>`,
  ].join("\n");
  return { subject, text, html };
}

export const sendContactEmailVerification = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let uid: string;
    try {
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await auth.verifyIdToken(idToken);
      uid = decodedToken.uid;
    } catch {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    try {
      const userSnap = await db.doc(`users/${uid}`).get();
      const userData = userSnap.exists ? userSnap.data() : undefined;

      if (userData?.contactEmailVerified === true) {
        // Nothing to resend. The account page should not be offering a
        // Resend control in this state at all, but a stale client (a second
        // open tab, a race with the researcher's own last click) is not an
        // error -- just say so.
        res.status(200).json({ success: true, alreadyVerified: true });
        return;
      }

      const recipient = contactEmailRecipient(userData);
      if (!recipient) {
        res.status(400).json({
          error: "Add a contact email address before requesting a code.",
          code: "no-contact-email",
        });
        return;
      }

      // ---------------------------------------------------------------------
      // CAN WE SEND AT ALL? ASKED BEFORE ANYTHING IS SPENT.
      // ---------------------------------------------------------------------
      //
      // Deliberately ahead of minting a code, writing the verification record,
      // and arming the resend cooldown. Ask afterwards and a researcher gets
      // told to check their inbox, gets a 60-second cooldown on requesting
      // another, and never receives anything -- the failure invisible on both
      // ends. Asking here also means a researcher clicking the button
      // repeatedly during a quota outage costs zero Resend requests, which is
      // the difference between a paused feature and a feature that makes the
      // outage worse.
      //
      // The message is vague on purpose. "Quota" is operational detail that
      // means nothing to a researcher, and one honest sentence covers every
      // terminal cause -- exhausted quota, an unverified domain, a revoked key
      // -- none of which they can act on differently anyway.
      const availability = verificationAvailability(await readMailStatus(), Date.now());
      if (!availability.available) {
        // ERROR, not WARN, and with a stable token: "verification is refused
        // for everybody" is a condition an operator wants to hear about,
        // especially in the `quota-reserve` case, where the only evidence that
        // the daily-quota header means what this code thinks it means is that
        // this line is NOT firing all day (docs/deploy-contact-email.md §6).
        console.error(
          `send-contact-email-verification: MailVerificationUnavailable (${availability.reason}) -- refused for ${uid}`
        );
        res.status(503).json({
          error:
            "We can't send verification codes right now. Please try again in a little while.",
          code: "mail-unavailable",
        });
        return;
      }

      const existing = await verificationRef(uid).get();
      const sentAt = existing.exists
        ? (existing.data()?.sentAt as number | undefined)
        : undefined;
      if (typeof sentAt === "number" && Date.now() - sentAt < RESEND_COOLDOWN_MS) {
        res.status(429).json({
          error: "Please wait a moment before requesting another code.",
          code: "rate-limited",
        });
        return;
      }

      const code = generateCode();
      const now = Date.now();

      // A fresh send REPLACES any prior record outright (set, not
      // update/merge): it always resets attempts to 0, and it always binds
      // to whichever address is on file right now -- even if the previous
      // record was for a since-changed address that was never verified.
      await verificationRef(uid).set({
        emailHash: hashContactEmail(recipient),
        codeHash: hashVerificationCode(code, uid),
        expiresAt: now + EXPIRY_MS,
        attempts: 0,
        sentAt: now,
      });

      const { subject, text, html } = buildVerificationEmail(code);
      // Non-transactional: unlike upload-failure-notify.ts's enqueueMail,
      // there is nothing else to keep consistent with the send -- this is a
      // direct response to a request the researcher just made, which is
      // exactly the case mail.ts's sendMail doc comment names.
      const mailRef = await sendMail({
        to: recipient,
        subject,
        text,
        html,
        meta: {
          kind: "contact-email-verification",
          owner: uid,
          // Delivered below, synchronously, by THIS request -- not by the
          // onmailcreated trigger, which stands down for inline mail. The
          // document is still written first, so the audit trail, the
          // purge-user-data handle and the TTL all work exactly as they do for
          // queued mail; only who performs the send changes.
          deliverInline: true,
        },
      });

      // ---------------------------------------------------------------------
      // THE EMULATOR NEVER SENDS, SO IT NEVER REPORTS A SEND FAILURE EITHER.
      // ---------------------------------------------------------------------
      //
      // onMailCreated returns before doing anything at all when
      // FUNCTIONS_EMULATOR is set, and the inline path has to make the same
      // promise -- otherwise it becomes the one route by which a local test run
      // could mail a real person, which is precisely the hole that gate exists
      // to close.
      //
      // It also has to answer 200. The mail document is written either way, and
      // contact-email-verify-emulator.test.js recovers the code from it exactly
      // as it did when the trigger owned delivery; answering 503 here would
      // fail every emulator-backed verification test on a send that was never
      // going to be attempted.
      //
      // Coverage does not suffer: the inline delivery path below is exercised
      // in-process, against the emulator, with an injected transport, by
      // mail-retry-emulator.test.js.
      if (process.env.FUNCTIONS_EMULATOR === "true") {
        console.log(
          `send-contact-email-verification: emulator instance, leaving mail ${mailRef.id} unsent`
        );
        res.status(200).json({ success: true });
        return;
      }

      // ---------------------------------------------------------------------
      // AWAITED, BECAUSE SOMEBODY IS WATCHING A FORM.
      // ---------------------------------------------------------------------
      //
      // The queue's asynchrony is right for a failure notification and wrong
      // here: a verification code that arrives tomorrow is not a late success,
      // it is a code that expired (EXPIRY_MS) before it landed. So this request
      // does not return until the send has actually happened or actually
      // failed. deliverMailDocument never throws -- every expected failure is a
      // returned outcome and a field on the document.
      const outcome = await deliverMailDocument(mailRef.id);
      if (outcome !== "sent") {
        // ---------------------------------------------------------------------
        // THE RECORD STAYS. IT IS THE RATE LIMIT.
        // ---------------------------------------------------------------------
        //
        // This branch used to delete it, so that a researcher whose code never
        // arrived would not be stuck behind a cooldown for a code that does not
        // exist. That reasoning is right about the researcher and wrong about
        // the endpoint: `sentAt` is the ONLY server-side throttle on this path,
        // and deleting it here removed the throttle from exactly the case that
        // needs one. A send that fails still costs a Resend request and still
        // writes a mail document, so a signed-in researcher holding the button
        // -- or a loop on one valid ID token -- drove both without any bound at
        // all, and the pre-send breaker did not cover it either, because it only
        // shut on quota errors.
        //
        // Two changes make that safe rather than merely throttled: the breaker
        // now also shuts on a systemic failure (mail-delivery.ts's
        // SYSTEMIC_ERRORS), so a revoked key or an unverified domain stops
        // costing a request per click within one attempt; and the code itself is
        // cleared here, so what survives is a cooldown and not a secret nobody
        // received. The researcher waits at most RESEND_COOLDOWN_MS, which is the
        // same minute they would wait after a send that worked.
        try {
          await verificationRef(uid).update({
            codeHash: null,
            deliveryFailedAt: now,
          });
        } catch (cleanupError) {
          // Non-fatal. The code is undeliverable either way and expires in 24
          // hours; what matters is that `sentAt` is still standing.
          console.error(
            `send-contact-email-verification: could not clear the unsent code for ${uid}:`,
            cleanupError instanceof Error ? cleanupError.message : "Unknown error"
          );
        }
        console.error(
          `send-contact-email-verification: delivery for ${uid} ended as ${outcome}, mail ${mailRef.id}`
        );
        res.status(503).json({
          error:
            "We couldn't send a verification code right now. Please try again in a little while.",
          code: "mail-unavailable",
        });
        return;
      }

      res.status(200).json({ success: true });
    } catch (error) {
      console.error(
        `send-contact-email-verification failed for ${uid}:`,
        error instanceof Error ? error.message : "Unknown error"
      );
      res.status(500).json({
        error: "Could not send the verification code. Please try again.",
      });
    }
  }
);
