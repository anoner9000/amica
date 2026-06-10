function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolveHostAwareLocalUrl(url: string): string {
  if (!url || typeof window === "undefined") {
    return url;
  }

  // Relative URLs are already same-origin — no host substitution needed.
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  try {
    const parsed = new URL(url, window.location.origin);

    if (!isLocalHostname(parsed.hostname)) {
      return parsed.toString();
    }

    if (
      window.location.protocol === "https:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "5000" &&
      parsed.pathname === "/tts"
    ) {
      return `${window.location.origin}/api/local-piper/tts`;
    }

    if (!isLocalHostname(window.location.hostname)) {
      parsed.hostname = window.location.hostname;
      return parsed.toString();
    }

    return parsed.toString();
  } catch {
    return url;
  }
}
