"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getUiLocaleHref, savePreferredUiLocale, type UiLocale } from "../lib/ui-locale";
import { messages } from "../lib/i18n";

export function LocaleToggle({ locale }: { readonly locale: UiLocale }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [storage, setStorage] = useState<Storage | null>(null);

  useEffect(() => {
    try {
      setStorage(window.localStorage);
    } catch {
      setStorage(null);
    }
  }, []);

  function changeLocale(next: UiLocale) {
    if (next === locale) return;
    if (storage) {
      try { savePreferredUiLocale(storage, next); } catch { /* Locale remains in the URL. */ }
    }
    const query = searchParams.toString();
    router.replace(`${pathname}${getUiLocaleHref(query ? `?${query}` : "", next)}`);
  }

  return (
    <div className="locale-toggle" role="group" aria-label={locale === "fa" ? "زبان" : "Language"}>
      {(["fa", "en"] as const).map((item) => (
        <button key={item} type="button" aria-pressed={locale === item} onClick={() => changeLocale(item)}>
          {item === "en" ? "EN" : "فا"}
        </button>
      ))}
    </div>
  );
}

