export type UiLocale = "fa" | "en";

const UI_LOCALE_KEY = "syncwatch.uiLocale";

export function getUiLocale(search: string, preferred: UiLocale | null = null): UiLocale {
  const requested = new URLSearchParams(search).get("lang");
  if (requested === "en" || requested === "fa") return requested;
  return preferred ?? "fa";
}

export function getUiLocaleHref(search: string, locale: UiLocale): string {
  const params = new URLSearchParams(search);
  if (locale === "fa") params.delete("lang");
  else params.set("lang", locale);
  const query = params.toString();
  return query ? `?${query}` : "?";
}

export function readPreferredUiLocale(storage: Pick<Storage, "getItem">): UiLocale | null {
  const locale = storage.getItem(UI_LOCALE_KEY);
  return locale === "fa" || locale === "en" ? locale : null;
}

export function savePreferredUiLocale(storage: Pick<Storage, "setItem">, locale: UiLocale): void {
  storage.setItem(UI_LOCALE_KEY, locale);
}
