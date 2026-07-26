import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { resolveByokSecret } from "@/lib/billing/crypto";
import { resolvePlanLimits } from "@/lib/billing/plan-core";
import {
  BillingNotReadyError,
  type ByokProvider,
  BYOK_PROVIDERS,
  deleteProviderKey,
  getPlatformSpendUsd,
  isByokProvider,
  listProviderKeys,
  markProviderKeyInvalid,
  type ProviderKeySummary,
  saveProviderKey,
} from "@/lib/billing/queries";
import {
  type KeyValidation,
  validateProviderKey,
} from "@/lib/billing/validate-key";
import { ChatbotError } from "@/lib/errors";

// The settings surface for "who pays". One route, because the three questions
// it answers — which keys do I have, how much of the free allowance is left,
// and can this deployment store a key at all — are always asked together and a
// dialog that renders them from three separate fetches can render them
// disagreeing with each other.

export type BillingKeysResponse = {
  keys: ProviderKeySummary[];
  providers: readonly ByokProvider[];
  usage: {
    /** Platform-funded spend this period, USD. BYOK spend is not counted. */
    spentUsd: number;
    allowanceUsd: number;
  };
  /**
   * False when ZENO_BYOK_SECRET is unset. Surfaced so the dialog can say so
   * before the user pastes a secret into a box that will refuse it — the
   * alternative is asking someone to hand over a credential and then telling
   * them it was for nothing.
   */
  storageConfigured: boolean;
  /**
   * True when the billing tables are not migrated. The UI must not read this
   * as "you have spent $0": that reading turns a missing migration into an
   * unlimited free tier in the user's mind.
   */
  unmetered: boolean;
};

const saveSchema = z.object({
  provider: z.string().refine(isByokProvider, "Unknown provider"),
  // No format check beyond non-empty. Every vendor's prefix convention has
  // changed at least once, and a regex that rejects a valid new format is a
  // bug the user cannot work around.
  apiKey: z.string().trim().min(8, "That key looks too short."),
  label: z.string().trim().max(80).optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const limits = resolvePlanLimits();
    const storageConfigured = Boolean(resolveByokSecret());

    try {
      const [keys, spentUsd] = await Promise.all([
        listProviderKeys(session.user.id),
        getPlatformSpendUsd(session.user.id),
      ]);

      const body: BillingKeysResponse = {
        keys,
        providers: BYOK_PROVIDERS,
        usage: { spentUsd, allowanceUsd: limits.monthlyAllowanceUsd },
        storageConfigured,
        unmetered: false,
      };
      return Response.json(body);
    } catch (error) {
      if (error instanceof BillingNotReadyError) {
        const body: BillingKeysResponse = {
          keys: [],
          providers: BYOK_PROVIDERS,
          usage: { spentUsd: 0, allowanceUsd: limits.monthlyAllowanceUsd },
          storageConfigured,
          unmetered: true,
        };
        return Response.json(body);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    console.error("GET /api/billing/keys failed", error);
    return new ChatbotError("bad_request:api", "Failed to load billing settings").toResponse();
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return new ChatbotError(
        "bad_request:api",
        parsed.error.issues[0]?.message ?? "Invalid request"
      ).toResponse();
    }

    const provider = parsed.data.provider as ByokProvider;

    // Probe first, save second — but the save happens either way. See
    // lib/billing/validate-key.ts for why this cannot be a gate.
    const validation: KeyValidation = await validateProviderKey({
      provider,
      apiKey: parsed.data.apiKey,
    });

    const summary = await saveProviderKey({
      userId: session.user.id,
      provider,
      apiKey: parsed.data.apiKey,
      label: parsed.data.label ?? null,
    });

    // A key the provider actively refused is stored but not routed to. The row
    // carries the reason, so the settings list shows the user what happened
    // instead of silently falling back to the platform allowance — the exact
    // silent-miss this whole layer exists to prevent.
    if (validation.verdict === "rejected") {
      await markProviderKeyInvalid({
        userId: session.user.id,
        provider,
        reason: validation.detail,
      });
    }

    return Response.json({
      key: {
        ...summary,
        ...(validation.verdict === "rejected"
          ? { status: "invalid" as const, lastError: validation.detail }
          : {}),
      },
      validation,
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    if (error instanceof BillingNotReadyError) {
      return new ChatbotError(
        "bad_request:api",
        "Key storage is not available on this deployment yet."
      ).toResponse();
    }
    console.error("POST /api/billing/keys failed", error);
    return new ChatbotError("bad_request:api", "Failed to save the key").toResponse();
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const provider = new URL(request.url).searchParams.get("provider");
    if (!(provider && isByokProvider(provider))) {
      return new ChatbotError("bad_request:api", "Unknown provider").toResponse();
    }

    await deleteProviderKey({ userId: session.user.id, provider });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    if (error instanceof BillingNotReadyError) {
      return Response.json({ ok: true });
    }
    console.error("DELETE /api/billing/keys failed", error);
    return new ChatbotError("bad_request:api", "Failed to remove the key").toResponse();
  }
}
