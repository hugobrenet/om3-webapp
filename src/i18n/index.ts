import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

/** The languages of the webapp: French for a French browser, English otherwise, as oc3. */
export const LANGUAGES = ["en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The name of each language in itself, as a language picker shows it. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", fr: "Français" };

const STORAGE_KEY = "om3.language";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGES.includes(value as Language);
}

export function browserLanguage(language: string | undefined): Language {
  return language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** The language chosen in the webapp, else the one of the browser. */
export function cachedLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Without storage, the language of the browser.
  }
  return browserLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
}

/** Speaks `language` at once, and keeps it for the next loads. */
export function setLanguage(language: Language): Promise<unknown> {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Without the cache the language stays right for this load: the browser's on the next.
  }
  return i18n.changeLanguage(language);
}

// The page language follows, for screen readers, hyphenation and the spell checker.
i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined") document.documentElement.lang = language;
});

// Every visible string goes through t(). No hard-coded string in the components.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: cachedLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export default i18n;
