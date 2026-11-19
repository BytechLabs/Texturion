export type SpeechLanguage = "en-US" | "fr-CA";

export function speechVoice(language: SpeechLanguage) {
  // Telnyx's basic voice only speaks en-US.
  return language === "fr-CA"
    ? { voice: "AWS.Polly.Chantal", service_level: "premium", language }
    : { voice: "female", language };
}
