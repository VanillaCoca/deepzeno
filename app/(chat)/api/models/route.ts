import {
  getActiveModels,
  getCapabilities,
  getDefaultModelId,
} from "@/lib/ai/models";

export function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const models = getActiveModels(process.env);
  const capabilities = getCapabilities(process.env);

  return Response.json(
    {
      models,
      capabilities,
      defaultModelId: getDefaultModelId(process.env),
    },
    { headers }
  );
}
