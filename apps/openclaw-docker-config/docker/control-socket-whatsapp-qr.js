const { stripAnsiTerminalCodes } = require("./control-socket-auth");

// `openclaw channels login --channel whatsapp` prints the pairing QR code
// directly to the terminal, not as a file or JSON payload (no such option
// exists — see `openclaw channels login --help`), so the control socket has
// to parse it out of captured stdout/stderr text.
//
// This has broken silently across an openclaw version bump before: an older
// build emitted the QR as ANSI background-color cells (`\x1b[40m`/`\x1b[47m`),
// which `extractAnsiQrToDataUrl` decodes below. openclaw 2026.6.11 instead
// renders it as plain Unicode half-block characters — the standard
// 2-pixel-rows-per-character terminal QR encoding used by tools like
// `qrencode -t ANSIUTF8` and the `qrcode-terminal` npm package: ' ' (both
// pixels light), '▀' (upper dark), '▄' (lower dark), '█' (both dark). No
// ANSI codes at all, so the old parser silently never matched and every
// pairing attempt timed out waiting for a QR that had already printed.
// `extractWhatsAppQrDataUrl` below tries both formats.
function extractWhatsAppQrDataUrl(output) {
  if (!output) {
    return undefined;
  }
  // Legacy format emitted by older OpenClaw builds (internal module).
  const match = String(output).match(/!\[whatsapp-qr]\((data:image\/[^)]+)\)/i);
  if (match?.[1]) {
    return match[1];
  }
  // Computed once and handed to both extractors below — output only grows
  // over a pairing session's lifetime, so re-deriving this same split by
  // calling each extractor with just `output` (as their own public
  // signature still allows, and their unit tests do) would re-scan the
  // whole buffer twice per call on the common path (openclaw 2026.6.11+
  // never matches the ANSI-only format, so extractUnicodeBlockQrToDataUrl
  // always runs second).
  const lines = linesAfterLatestQrTrigger(output);
  return (
    extractAnsiQrToDataUrl(output, lines) ??
    extractUnicodeBlockQrToDataUrl(output, lines)
  );
}

// lastIndexOf, not indexOf: the CLI reprints the whole "scan this QR:" block
// each time the underlying WhatsApp Web QR rotates while unscanned (observed
// roughly every 20-60s), appending to the same growing output buffer —
// indexOf would keep re-extracting the first, by-then-stale QR forever
// instead of the current one.
function linesAfterLatestQrTrigger(output) {
  const text = String(output || "");
  const triggerIdx = text.lastIndexOf("scan this QR:");
  if (triggerIdx === -1) {
    return undefined;
  }
  return text.slice(triggerIdx + "scan this QR:".length).split("\n");
}

function extractAnsiQrToDataUrl(output, precomputedLines) {
  const lines = precomputedLines ?? linesAfterLatestQrTrigger(output);
  if (!lines) {
    return undefined;
  }
  const qrRows = [];

  for (const line of lines) {
    if (!/\x1b\[(?:47|40)m/.test(line)) {
      // Stop as soon as we leave the QR block (first non-ANSI line after it starts).
      if (qrRows.length > 0) {
        break;
      }
      continue;
    }
    const row = [];
    const cellRe = /\x1b\[(47|40)m {2}\x1b\[0m/g;
    let m;
    while ((m = cellRe.exec(line)) !== null) {
      // 40 = black background → dark QR module; 47 = white background → light.
      row.push(m[1] === "40" ? 1 : 0);
    }
    if (row.length > 0) {
      qrRows.push(row);
    }
  }

  if (qrRows.length === 0) {
    return undefined;
  }

  return renderQrRowsToDataUrl(qrRows);
}

// Exported so control-socket-server.js's sanitizeWhatsAppPairOutput can
// recognize the same QR glyphs when collapsing them out of human-readable
// status text, instead of re-encoding this character set a second time.
const UNICODE_QR_CHARS_STRING = " ▀▄█";
const UNICODE_QR_CHARS = new Set([...UNICODE_QR_CHARS_STRING]);

function extractUnicodeBlockQrToDataUrl(output, precomputedLines) {
  const rawLines = precomputedLines ?? linesAfterLatestQrTrigger(output);
  if (!rawLines) {
    return undefined;
  }
  const lines = rawLines.map((line) => line.replace(/\r$/, ""));
  const qrLines = [];

  for (const rawLine of lines) {
    // Whether these lines carry ANSI color codes around the QR glyphs
    // (e.g. `\x1b[47m\x1b[30m ▄▄▄ \x1b[0m`) depends on how openclaw's color
    // detection resolves for the spawning process — observed both with and
    // without color wrapping across otherwise-identical invocations. Strip
    // any ANSI escapes before checking the glyphs either way.
    //
    // No `.trim()`: a leading/trailing space is a real light QR module, not
    // incidental whitespace. Trimming it made row lengths vary line to line
    // (62-65 chars observed on an otherwise-uniform 65-module-wide QR),
    // shifting every module after a trimmed leading space one column to the
    // left on just that row — a real capture, corrupted into an unscannable
    // QR, not a cosmetic misalignment.
    const line = stripAnsiTerminalCodes(rawLine);
    if (!line) {
      if (qrLines.length > 0) {
        break;
      }
      continue;
    }
    if (![...line].every((ch) => UNICODE_QR_CHARS.has(ch))) {
      if (qrLines.length > 0) {
        break;
      }
      continue;
    }
    qrLines.push(line);
  }

  if (qrLines.length === 0) {
    return undefined;
  }

  // Each character packs two vertical QR-module rows: top half + bottom half.
  const qrRows = [];
  for (const line of qrLines) {
    const topRow = [];
    const bottomRow = [];
    for (const ch of line) {
      const top = ch === "▀" || ch === "█" ? 1 : 0;
      const bottom = ch === "▄" || ch === "█" ? 1 : 0;
      topRow.push(top);
      bottomRow.push(bottom);
    }
    qrRows.push(topRow, bottomRow);
  }

  return renderQrRowsToDataUrl(qrRows);
}

function renderQrRowsToDataUrl(qrRows) {
  // Render as a minimal SVG — no external deps needed.
  const cellPx = 8;
  const cols = Math.max(...qrRows.map((r) => r.length));
  const svgWidth = cols * cellPx;
  const svgHeight = qrRows.length * cellPx;

  let rects = "";
  for (let y = 0; y < qrRows.length; y++) {
    for (let x = 0; x < qrRows[y].length; x++) {
      if (qrRows[y][x] === 1) {
        rects += `<rect x="${x * cellPx}" y="${y * cellPx}" width="${cellPx}" height="${cellPx}"/>`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" ` +
    `style="background:white"><g fill="black">${rects}</g></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

module.exports = {
  extractWhatsAppQrDataUrl,
  extractAnsiQrToDataUrl,
  extractUnicodeBlockQrToDataUrl,
  UNICODE_QR_CHARS_STRING,
};
