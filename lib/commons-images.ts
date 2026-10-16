import type { ImageAsset } from "./lesson-schema.ts";
const plain = (s = "") => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
export function isCommonsImageUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === "https:" && ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(u.hostname) && !u.port && !u.username && !u.password && u.pathname.startsWith("/wikipedia/commons/"); }
  catch { return false; }
}

export type CommonsPage = { title: string; imageinfo?: Array<{ url: string; thumburl?: string; width: number; height: number; thumbwidth?: number; thumbheight?: number; sha1: string; mime: string; extmetadata?: Record<string, { value: string }> }> };
export function commonsAsset(page: CommonsPage): ImageAsset | null {
  const info = page.imageinfo?.[0];
  if (!info || !["image/jpeg", "image/png", "image/svg+xml", "image/webp"].includes(info.mime)) return null;
  const meta = info.extmetadata ?? {};
  const license = plain(meta.LicenseShortName?.value || meta.License?.value || "");
  // Commons includes multiple license families. Only explicit free commercial terms enter lessons;
  // strictly reject noncommercial (NC), no-derivatives (ND), all-rights-reserved, or unknown terms.
  if (/(-NC|-ND|\bNC\b|\bND\b|all rights reserved|non-commercial|noncommercial)/i.test(license)) return null;
  const isFree = /^(CC0|CC0\s*1\.0|Public domain|PD|PD-.*|CC[- ]BY.*|Attribution.*|Creative Commons.*)$/i.test(license);
  if (!isFree) return null;
  const url = info.thumburl || info.url;
  if (!isCommonsImageUrl(url) || /watermark/i.test(page.title)) return null;
  const cc = /CC[- ](BY(?:-SA)?)[- ]?([1-4]\.0)?/i.exec(license);
  const fallbackLicenseUrl = cc ? `https://creativecommons.org/licenses/${cc[1].toLowerCase().replace("-", "")}/${cc[2] || "4.0"}/`
    : /CC0/i.test(license) ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/publicdomain/mark/1.0/";
  const licenseUrl = meta.LicenseUrl?.value?.replace(/^\/\//, "https://").replace(/^http:\/\//, "https://") || fallbackLicenseUrl;
  const finalLicenseUrl = /^https:\/\/(creativecommons\.org|commons\.wikimedia\.org|en\.wikipedia\.org)\//.test(licenseUrl) ? licenseUrl : fallbackLicenseUrl;
  return { id: info.sha1, title: plain(page.title).slice(0, 300), url,
    sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    author: plain(meta.Artist?.value || meta.Credit?.value || "See original source").slice(0, 500), license: license || "CC-BY", licenseUrl: finalLicenseUrl,
    width: info.thumbwidth || info.width, height: info.thumbheight || info.height, regions: [] };
}


