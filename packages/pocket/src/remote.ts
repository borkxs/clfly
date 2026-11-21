// The superbar on a phone: the page is loaded over the tailnet, the commands run on the Mac.
// A command that would open something on the Mac (`dash open film`) is told the caller is
// remote (CLFLY_REMOTE=1) and answers with a URL the phone can load; the page goes there.
// Pure: app.ts owns the DOM and the navigation.
//
// phone ──run {remote:true}──▶ engine ──CLFLY_REMOTE=1──▶ bin ──{remote:true,url}──▶ phone opens url

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

/** Is the page being read on another device than the one running the engine? */
export function isRemoteHost(hostname: string): boolean {
  return !LOCAL.has(hostname.toLowerCase());
}

/** The URL a finished run asks a remote page to open: `{ remote: true, url: "http(s)://…" }`. */
export function remoteUrl(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const { remote, url } = json as { remote?: unknown; url?: unknown };
  if (remote !== true || typeof url !== "string") return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}
