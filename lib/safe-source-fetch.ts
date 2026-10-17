import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";

const MAX_REMOTE_BYTES = 2 * 1024 * 1024;

/** Conservative public-address allowlist, including IPv4-mapped IPv6 handling. */
export function isPublicAddress(address: string): boolean {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) !== 6) return false;
  ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  // Global unicast only. Reject transition, benchmark and documentation ranges.
  return /^[23][0-9a-f]{3}:/.test(ip) && !/^2001:(?:0*:|0?2:|0?10:|0?20:|db8:)/.test(ip) && !/^2002:/.test(ip) && !/^3fff:/.test(ip);
}

export function validateSourceUrl(input: string): URL {
  const url = new URL(input);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
    || (url.port && !["80", "443"].includes(url.port))) throw new Error("Use a public HTTP or HTTPS URL on its standard port.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || /\.(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)
    || (!host.includes(".") && !isIP(host)) || (isIP(host) && !isPublicAddress(host))) throw new Error("Private and local network URLs cannot be imported.");
  return url;
}

export async function fetchPublicSource(input: string, signal?: AbortSignal, redirects = 0): Promise<{ url: string; text: string; contentType: string }> {
  signal?.throwIfAborted();
  if (redirects > 3) throw new Error("The source redirected too many times.");
  const url = validateSourceUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(new Error("Source DNS lookup timed out.")), 5000); timeout.unref(); }),
  ]);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error("The source must resolve only to public network addresses.");
  const pinned = addresses[0];
  const result = await new Promise<{ status: number; location?: string; text: string; contentType: string }>((resolve, reject) => {
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    // Pin the checked DNS address for this connection; do not resolve again at fetch time.
    const req = requester(url, {
      agent: false,
      signal,
      headers: { "User-Agent": "Chalkie-SourceReader/1.0", Accept: "text/html,text/plain,application/json,text/xml", "Accept-Encoding": "identity" },
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
    }, response => {
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume(); resolve({ status, location: response.headers.location, text: "", contentType: "" }); return;
      }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`The source returned HTTP ${status}. Paste the text if the page blocks imports.`)); return; }
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") { response.destroy(); reject(new Error("This source requires a compressed response. Paste its text instead.")); return; }
      const contentType = String(response.headers["content-type"] ?? "text/plain").toLowerCase();
      if (!/text\/|application\/(?:json|xml|xhtml\+xml)/.test(contentType)) { response.destroy(); reject(new Error("Upload PDF or DOCX files directly; URLs must contain readable pages or transcripts.")); return; }
      if (Number(response.headers["content-length"] ?? 0) > MAX_REMOTE_BYTES) { response.destroy(); reject(new Error("This source is too large. Paste a relevant excerpt.")); return; }
      let bytes = 0;
      const buffers: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_REMOTE_BYTES) { response.destroy(new Error("Source exceeds the 2 MB import limit.")); return; }
        buffers.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status, text: Buffer.concat(buffers).toString("utf8"), contentType }));
    });
    const timeout = setTimeout(() => req.destroy(new Error("Source import timed out. Paste the text instead.")), 12000);
    req.on("error", reject);
    req.on("close", () => clearTimeout(timeout));
    req.end();
  });
  if (result.location) return fetchPublicSource(new URL(result.location, url).href, signal, redirects + 1);
  return { url: url.href, text: result.text, contentType: result.contentType };
}
