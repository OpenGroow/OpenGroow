import { describe, expect, it } from "vitest";
import { outboundUrlProblem } from "./outbound-url";

describe("outboundUrlProblem (hosted deployment: URLs a package may make the shared backend call)", () => {
  it.each([
    "https://seo.example.com/mcp",
    "http://seo.example.com:8080/mcp?x=1",
    "https://8.8.8.8/mcp",
    "https://[2606:4700:4700::1111]/mcp",
    "https://172.32.0.1/mcp",
    "https://100.63.255.255/mcp",
  ])("accepts the public URL %s", (url) => {
    expect(outboundUrlProblem(url)).toBeUndefined();
  });

  it.each([
    // loopback and unspecified
    "http://localhost:4000/mcp",
    "http://LOCALHOST/mcp",
    "http://localhost./mcp",
    "http://foo.localhost/mcp",
    "http://127.0.0.1/mcp",
    "http://127.255.255.254/mcp",
    "http://0.0.0.0/mcp",
    "http://[::1]/mcp",
    "http://[::]/mcp",
    // private IPv4
    "http://10.0.0.5/mcp",
    "http://172.16.0.1/mcp",
    "http://172.31.255.255/mcp",
    "http://192.168.1.1/mcp",
    // link-local and cloud metadata
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[fe80::1]/mcp",
    // other reserved ranges
    "http://100.64.0.1/mcp",
    "http://198.18.0.1/mcp",
    "http://192.0.2.1/mcp",
    "http://224.0.0.1/mcp",
    "http://255.255.255.255/mcp",
    "http://[ff02::1]/mcp",
    "http://[2001:db8::1]/mcp",
    "http://[fc00::1]/mcp",
    // internal names
    "http://host.docker.internal:4000/mcp",
    "http://article-mcp/mcp",
    "http://printer.local/mcp",
    "http://db.internal/mcp",
    // encoded-IP tricks: the URL parser normalizes them to a private IPv4
    "http://2130706433/mcp",
    "http://0x7f000001/mcp",
    "http://0x7f.0.0.1/mcp",
    "http://017700000001/mcp",
    "http://127.1/mcp",
    "http://0177.0.0.1/mcp",
    "http://2852039166/mcp",
    // IPv6 forms embedding a private IPv4
    "http://[::ffff:127.0.0.1]/mcp",
    "http://[::ffff:7f00:1]/mcp",
    "http://[::ffff:a9fe:a9fe]/mcp",
    "http://[64:ff9b::7f00:1]/mcp",
    "http://[2002:7f00:1::]/mcp",
    "http://[::127.0.0.1]/mcp",
    // userinfo tricks
    "http://user:pw@seo.example.com/mcp",
    "http://seo.example.com@127.0.0.1/mcp",
    "http://evil@seo.example.com/mcp",
    // schemes and garbage
    "file:///etc/passwd",
    "ftp://seo.example.com/mcp",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("refuses %s", (url) => {
    expect(outboundUrlProblem(url)).toEqual(expect.any(String));
  });
});
