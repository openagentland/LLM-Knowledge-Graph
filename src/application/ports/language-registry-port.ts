import type { LanguageCapability } from "../dto/structured-observations.js";

export interface LanguageRegistryPort {
  detect(path: string): LanguageCapability | null;
  detectArtifact(path: string): LanguageCapability | null;
  list(): LanguageCapability[];
}
