import type { CapabilityReport, CapabilityState, DashboardSnapshot, ParserWarning } from "../contracts/dashboard";

export interface CapabilityEntry {
  readonly key: keyof CapabilityReport;
  readonly state: CapabilityState;
}

export interface ShellStatusModel {
  readonly generatedAt: string;
  readonly capabilityEntries: readonly CapabilityEntry[];
  readonly warnings: readonly ParserWarning[];
  readonly sourceLabel: string;
  readonly dataRoot: string;
  readonly offloadRoot: string;
  readonly environmentInputs: readonly string[];
}

export function createShellStatusModel(snapshot: DashboardSnapshot): ShellStatusModel {
  return {
    generatedAt: snapshot.generatedAt,
    capabilityEntries: capabilityEntries(snapshot.capabilityReport),
    warnings: snapshot.warnings,
    sourceLabel: snapshot.dataSource.sourceLabel,
    dataRoot: snapshot.dataSource.memoryRootPath,
    offloadRoot: snapshot.dataSource.offloadRootPath,
    environmentInputs: snapshot.dataSource.environmentInputs,
  };
}

export function capabilityEntries(report: CapabilityReport): readonly CapabilityEntry[] {
  return [
    { key: "persona", state: report.persona },
    { key: "scenes", state: report.scenes },
    { key: "structuredMemories", state: report.structuredMemories },
    { key: "conversationEvidence", state: report.conversationEvidence },
    { key: "offloadCanvas", state: report.offloadCanvas },
    { key: "gatewayHealth", state: report.gatewayHealth },
    { key: "gatewaySearch", state: report.gatewaySearch },
    { key: "gatewayRecall", state: report.gatewayRecall },
  ];
}

export function hasDegradedCapabilities(report: CapabilityReport): boolean {
  return capabilityEntries(report).some((entry) => entry.state.status !== "available");
}

export function summarizeWarnings(warnings: readonly ParserWarning[]): string {
  if (warnings.length === 0) return "当前没有解析告警。";
  return warnings
    .slice(0, 4)
    .map((warning) => `${warning.code}: ${warning.message}`)
    .join(" ");
}
