import {
  getActiveModels,
  getCapabilities,
  getDefaultModelId,
} from "@/lib/ai/models";
import { isProductionEnvironment } from "@/lib/constants";

export function GET() {
  // The active model set is env-derived, so it changes whenever keys are added
  // or a deploy flips a provider. A long browser max-age caused a stale list to
  // linger client-side and disagree with the server's active set — selecting a
  // no-longer-active model then failed validation ("Model preference was not
  // saved"). Let the CDN cache but keep the browser revalidating; never cache in
  // dev so newly configured keys show up on the next reload.
  const headers = {
    "Cache-Control": isProductionEnvironment
      ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
      : "no-store",
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
