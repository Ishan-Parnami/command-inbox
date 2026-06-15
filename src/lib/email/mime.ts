import "server-only";

export type OutgoingMessage = {
  from?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
};

// Encode a header value that may contain non-ASCII as RFC 2047 (=?UTF-8?B?…?=).
function encodeHeader(value: string) {
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Build an RFC 2822 plain-text message and base64url-encode it (Gmail `raw`). */
export function buildRawMessage({ from, to, cc, subject, body }: OutgoingMessage): string {
  const lines = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${to.join(", ")}`,
    ...(cc?.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}
