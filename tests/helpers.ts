import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateId } from "ai";
import { getUnixTime } from "date-fns";

export function generateRandomTestUser() {
  const email = `test-${getUnixTime(new Date())}-${generateId().slice(0, 8)}@playwright.com`;
  const password = generateId();

  return {
    email,
    password,
  };
}

export function generateTestMessage() {
  return `Test message ${Date.now()}`;
}

export const hasSupabaseE2EConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const hasModelProviderE2EConfig = Boolean(
  process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.AI_GATEWAY_API_KEY
);

function getSupabaseE2EConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase E2E environment variables are not configured.");
  }

  return { url, serviceRoleKey };
}

export async function createConfirmedTestUser() {
  if (!hasSupabaseE2EConfig) {
    throw new Error("Supabase E2E environment variables are not configured.");
  }

  const { email, password } = generateRandomTestUser();
  const { url, serviceRoleKey } = getSupabaseE2EConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw error ?? new Error("Failed to create a Playwright test user.");
  }

  return {
    id: data.user.id,
    email,
    password,
  };
}

export async function deleteTestUser(userId: string) {
  if (!hasSupabaseE2EConfig) {
    return;
  }

  const { url, serviceRoleKey } = getSupabaseE2EConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  await supabase.auth.admin.deleteUser(userId);
}

export async function signInThroughLoginPage(
  page: Page,
  credentials: { email: string; password: string }
) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(credentials.email);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/" ||
      url.pathname === "/chat/new" ||
      /^\/chat\/[\w-]+$/.test(url.pathname),
    { timeout: 15_000 }
  );
}
