export function allowedOrigin(origin: string | undefined, protocol: string, host: string | undefined, allowlist: string[]) {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return false;
    return origin === `${protocol}://${host}` || allowlist.includes(origin);
  } catch { return false; }
}

export function referencesAsset(value: unknown, assetUrl: string): boolean {
  if (Array.isArray(value)) return value.some(item => referencesAsset(item, assetUrl));
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (typeof action.url === "string") {
    try { if (decodeURIComponent(new URL(action.url, "http://local").pathname) === assetUrl) return true; } catch { /* Invalid URL cannot reference asset. */ }
  }
  return Object.values(action).some(item => typeof item === "object" && referencesAsset(item, assetUrl));
}