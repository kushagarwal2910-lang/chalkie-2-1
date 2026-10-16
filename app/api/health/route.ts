import { resolveProviderCredentials } from "@/lib/provider-credentials";
import { TEXT_MODEL, VISION_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = await resolveProviderCredentials();
  return Response.json({
    ok: true,
    mode: providers.groqKeys.length ? "live" : "needs_keys",
    services: {
      groq: providers.groqKeys.length > 0,
      groqKeyCount: providers.groqKeys.length,
      groqSource: providers.source,
      tavily: Boolean(providers.tavilyKey),
      tavilySource: providers.tavilySource,
      embeddings: Boolean(process.env.EMBEDDING_BASE_URL && process.env.EMBEDDING_API_KEY && process.env.EMBEDDING_MODEL),
      googleDrive: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET),
      canvas: "excalidraw",
      visionModel: VISION_MODEL,
    },
    model: TEXT_MODEL,
  });
}
