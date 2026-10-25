// A friendly default name for this browser, e.g. "Chrome on Mac" or "Safari on iPhone", so the
// device list reads like the person's own things rather than user-agent strings.

function browser(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "This browser";
}

function system(ua: string): string | null {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

export function friendlyName(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const os = system(ua);
  const name = browser(ua);
  return (os ? `${name} on ${os}` : name).slice(0, 60);
}

/** A phone or tablet, by the name it was given (for the icon). */
export function looksHandheld(name: string): boolean {
  return /iphone|ipad|android|phone|tablet|pixel|galaxy/i.test(name);
}
