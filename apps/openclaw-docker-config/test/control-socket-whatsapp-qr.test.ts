import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  extractWhatsAppQrDataUrl,
  extractAnsiQrToDataUrl,
  extractUnicodeBlockQrToDataUrl,
} = require("../docker/control-socket-whatsapp-qr.js") as {
  extractWhatsAppQrDataUrl: (output: string) => string | undefined;
  extractAnsiQrToDataUrl: (output: string) => string | undefined;
  extractUnicodeBlockQrToDataUrl: (output: string) => string | undefined;
};

// Verbatim (trimmed to a few rows) from a real `openclaw channels login
// --channel whatsapp` run on openclaw 2026.6.11 — the Unicode half-block
// format, no ANSI color codes at all, unlike the older format
// extractAnsiQrToDataUrl was built for.
const UNICODE_QR_OUTPUT = [
  "Waiting for WhatsApp connection...",
  "Open the WhatsApp app, go to Linked Devices, then scan this QR:",
  " ▄▄▄▄▄▄▄ ▄      ▄▄   ▄▄   ▄  ▄ ▄▄▄  ▄ ▄▄  ▄▄▄▄▄      ▄  ▄  ▄▄▄▄▄▄▄",
  " █ ▄▄▄ █ ██▀▀▄ ▀▀██▄█ ██▄█▀▀▄ ██ ▀  ▀▄▄   ██▄▄ ▀▄▀▄▀▄█ ▄ █ █ ▄▄▄ █",
  " █▄▄▄▄▄█ ▄▀█ █ █▀█▀▄▀▄▀█ ▄▀▄ █ █ ▄ █▀▄ █ █▀▄ █▀▄▀█ █ ▄▀█ ▄ █▄▄▄▄▄█",
  "",
  "Some trailing log line after the QR block.",
].join("\n");

describe("extractWhatsAppQrDataUrl", () => {
  it("decodes the Unicode half-block QR format (openclaw 2026.6.11+)", () => {
    const dataUrl = extractWhatsAppQrDataUrl(UNICODE_QR_OUTPUT);

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");
    expect(svg).toContain("<svg");
    // 3 QR-block lines × 2 pixel-rows each = 6 module rows tall.
    expect(svg).toContain('height="48"');
  });

  it("decodes Unicode half-blocks wrapped in ANSI color codes (real openclaw 2026.6.11 output, verified via direct `docker exec` — a terminal that renders color live, like the one a self-hoster's browser/log viewer never is, strips these before a human would copy-paste them)", () => {
    const line1 = "\x1b[47m\x1b[30m ▄▄▄▄▄▄▄ ▄▄▄▄  ▄▄▄▄ ▄      ▄ ▄ ▄▄▄  \x1b[0m";
    const line2 = "\x1b[47m\x1b[30m █ ▄▄▄ █ ▄▀▄▀ █   ██ █▄█▀▀ ▄▀█▀ ▀▄  \x1b[0m";
    const output = [
      "Open the WhatsApp app, go to Linked Devices, then scan this QR:",
      line1,
      line2,
      "",
    ].join("\n");

    const dataUrl = extractWhatsAppQrDataUrl(output);

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");
    // 2 QR-block lines × 2 pixel-rows each = 4 module rows tall.
    expect(svg).toContain('height="32"');
  });

  it("preserves leading/trailing light-module spaces instead of trimming them (regression: trimming shifted every module after a leading space one column left on that row, corrupting alignment)", () => {
    // Row 1: dark module at column 0, nothing else.
    // Row 2: dark module at column 1 — a leading space is real data here,
    // not incidental whitespace. A naive `.trim()` would collapse it to
    // column 0, aliasing it onto row 1's module and desyncing every column
    // after it for the rest of that row.
    const output = [
      "scan this QR:",
      "█  ",
      " █ ",
      "",
    ].join("\n");

    const dataUrl = extractUnicodeBlockQrToDataUrl(output);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");

    // Row 1 (y=0..15, top+bottom of "█") dark module at x=0.
    expect(svg).toContain('<rect x="0" y="0" width="8" height="8"/>');
    // Row 2 (y=16..31) dark module at x=8 (column 1), not x=0.
    expect(svg).toContain('<rect x="8" y="16" width="8" height="8"/>');
    expect(svg).not.toContain('<rect x="0" y="16" width="8" height="8"/>');
  });

  it("extracts the newest QR when the CLI reprints the whole block on refresh (Baileys-style QR rotation while unscanned), not the first one seen", () => {
    const output = [
      "scan this QR:",
      "█  ", // stale QR, row 1: dark module at column 0
      " █ ", // stale QR, row 2
      "some interim log line",
      "scan this QR:",
      "  █", // fresh QR, row 1: dark module at column 2 — distinguishable
      "█  ", // fresh QR, row 2
      "",
    ].join("\n");

    const dataUrl = extractUnicodeBlockQrToDataUrl(output);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");

    // Fresh QR's row 1 has its dark module at column 2 (x=16), not column 0.
    expect(svg).toContain('<rect x="16" y="0" width="8" height="8"/>');
    expect(svg).not.toContain('<rect x="0" y="0" width="8" height="8"/>');
  });

  it("still decodes the legacy ANSI background-color QR format", () => {
    const output = [
      "scan this QR:",
      "\x1b[40m  \x1b[0m\x1b[47m  \x1b[0m\x1b[40m  \x1b[0m",
      "\x1b[47m  \x1b[0m\x1b[40m  \x1b[0m\x1b[47m  \x1b[0m",
      "not part of the QR",
    ].join("\n");

    const dataUrl = extractAnsiQrToDataUrl(output);

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("returns undefined when no QR trigger line is present", () => {
    expect(extractWhatsAppQrDataUrl("nothing to see here")).toBeUndefined();
    expect(extractUnicodeBlockQrToDataUrl("nothing to see here")).toBeUndefined();
  });

  it("prefers the legacy markdown data-url format when present", () => {
    const output =
      "![whatsapp-qr](data:image/png;base64,AAAA)\nscan this QR:\n█";
    expect(extractWhatsAppQrDataUrl(output)).toBe(
      "data:image/png;base64,AAAA",
    );
  });
});
