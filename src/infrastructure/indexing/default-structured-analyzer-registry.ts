import type { ParsedDocument } from "../../application/dto/ingestion.js";
import type { LanguageRegistryPort } from "../../application/ports/language-registry-port.js";
import type { StructuredAnalyzerPort } from "../../application/ports/structured-analyzer-port.js";
import type { StructuredAnalyzerRegistryPort } from "../../application/ports/structured-analyzer-registry-port.js";

export class DefaultStructuredAnalyzerRegistry
  implements StructuredAnalyzerRegistryPort
{
  constructor(
    private readonly analyzers: StructuredAnalyzerPort[],
    private readonly languageRegistry?: LanguageRegistryPort,
  ) {}

  select(document: ParsedDocument): StructuredAnalyzerPort[] {
    const artifactCapability = this.languageRegistry?.detectArtifact(document.path);
    const languageCapability = this.languageRegistry?.detect(document.path);
    const capability = artifactCapability ?? languageCapability;

    const supportedAnalyzers = this.analyzers.filter((analyzer) => analyzer.supports(document));
    if (capability === null || capability === undefined) {
      return supportedAnalyzers;
    }

    return supportedAnalyzers.filter((analyzer) => {
      if (analyzer.id === undefined) {
        return true;
      }

      if (analyzer.id.startsWith("artifact:") && artifactCapability !== null && artifactCapability !== undefined) {
        return true;
      }

      if (analyzer.id === "generic-structural") {
        return capability.fallbackStrategy === "generic-structural";
      }

      return capability.analyzerEngines.some((engine) => analyzer.id?.includes(engine) === true);
    });
  }
}
