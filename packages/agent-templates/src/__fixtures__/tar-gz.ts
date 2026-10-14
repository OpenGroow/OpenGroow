/**
 * A minimal `.tar.gz` writer for the Git install tests (#667), independent from
 * the reader under test. `type` is the ustar typeflag ("0" file, "5" folder,
 * "2" symlink, "g"/"x" pax headers); a `pax` entry writes its records body.
 */
import { gzipSync } from "node:zlib";

export type TarEntry = { name: string; content?: string | Buffer; type?: string; linkname?: string; pax?: Record<string, string> };

/** Pax records body: each record is `<length> <key>=<value>\n`, length counting itself. */
function paxBody(records: Record<string, string>): string {
  return Object.entries(records)
    .map(([key, value]) => {
      const rest = ` ${key}=${value}\n`;
      let length = rest.length + 1;
      while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
      return `${length}${rest}`;
    })
    .join("");
}

export function tarGz(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, content = "", type = "0", linkname = "", pax } of entries) {
    const data = Buffer.from(pax ? paxBody(pax) : content);
    const header = Buffer.alloc(512);
    header.write(name.slice(0, 100), 0, "utf-8");
    header.write("0000644\0", 100);
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write(type, 156);
    header.write(linkname, 157);
    header.write("ustar\0" + "00", 257);
    header.write("        ", 148);
    const sum = [...header].reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
