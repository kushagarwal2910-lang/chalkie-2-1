import { z } from "zod";

export const SOURCE_LIMITS = { materials: 8, textCharacters: 100_000, fileBytes: 20 * 1024 * 1024, pdfPages: 40, images: 8, imageCharacters: 900_000 } as const;

export const sourceImageSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(180),
  dataUrl: z.string().max(SOURCE_LIMITS.imageCharacters).regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().positive().max(2400),
  height: z.number().int().positive().max(2400),
  page: z.number().int().positive().max(SOURCE_LIMITS.pdfPages).optional(),
  kind: z.enum(["embedded", "page"]),
});

export const sourceMaterialSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  title: z.string().trim().min(1).max(180),
  kind: z.enum(["pdf", "docx", "url", "text", "youtube"]),
  text: z.string().trim().max(SOURCE_LIMITS.textCharacters),
  url: z.string().max(2000).url().refine(value => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS source URL.").optional(),
  images: z.array(sourceImageSchema).max(SOURCE_LIMITS.images).default([]),
}).refine(value => value.text.length >= 20 || value.images.length > 0, "Add at least 20 characters of source text or a document diagram.");

export const sourceMaterialsSchema = z.array(sourceMaterialSchema).max(SOURCE_LIMITS.materials)
  .refine(values => new Set(values.map(value => value.id)).size === values.length, "Source IDs must be unique.")
  .refine(values => values.reduce((count, value) => count + value.images.length, 0) <= SOURCE_LIMITS.images, "Use at most eight document diagrams per lesson.");

export type SourceImage = z.infer<typeof sourceImageSchema>;
export type SourceMaterial = z.infer<typeof sourceMaterialSchema>;
export type SourceResearchOptions = { sourceMaterials?: SourceMaterial[]; includeWebSearch?: boolean };

/** A document locator, not a remote URL. The source UI must render it without a link. */
export function sourceMaterialUrl(material: Pick<SourceMaterial, "id" | "url">) {
  return material.url || `chalkie-source:${material.id}`;
}

export function isUserSourceUrl(url: string) { return /^chalkie-source:[a-zA-Z0-9_-]{1,80}$/.test(url); }

export function sourceEvidenceText(material: SourceMaterial) {
  // A figure's title is not substantive evidence. Vision-derived descriptions may
  // be appended by the lesson pipeline, but a file name alone must never pass RAG.
  return material.text.trim();
}
