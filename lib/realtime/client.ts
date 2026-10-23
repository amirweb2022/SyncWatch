import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";

export interface RealtimeConfig {
  readonly url: string;
  readonly anonKey: string;
}

export type RealtimeClientOptions = SupabaseClientOptions<"public">;

function readConfigValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function getRealtimeConfig(): RealtimeConfig {
  const url = readConfigValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = readConfigValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Supabase configuration is missing or malformed");
  }
  if ((parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") ||
      parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash || !anonKey) {
    throw new Error("Supabase configuration is missing or malformed");
  }
  return Object.freeze({ url: parsedUrl.origin, anonKey });
}

export function createRealtimeClient(
  clientOptions: SupabaseClientOptions<"public"> = {},
): SupabaseClient {
  const { url, anonKey } = getRealtimeConfig();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...clientOptions,
  });
}
