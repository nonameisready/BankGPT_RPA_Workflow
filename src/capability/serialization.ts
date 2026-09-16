import YAML from "yaml";
import { CapabilityArtifactSchema, type CapabilityArtifact } from "./artifact-schema.js";

export type ArtifactFormat = "yaml" | "json";

export function parseArtifact(serialized: string, format: ArtifactFormat): CapabilityArtifact {
  const candidate: unknown = format === "yaml" ? YAML.parse(serialized) : JSON.parse(serialized);
  return CapabilityArtifactSchema.parse(candidate);
}

export function serializeArtifact(artifact: CapabilityArtifact, format: ArtifactFormat): string {
  const validated = CapabilityArtifactSchema.parse(artifact);
  return format === "yaml" ? YAML.stringify(validated) : `${JSON.stringify(validated, null, 2)}\n`;
}
