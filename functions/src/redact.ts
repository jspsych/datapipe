// Replaces every occurrence of `secret` in `text` before it is logged. An
// empty secret is a no-op: "abc".split("") would otherwise redact between
// every character.
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}
