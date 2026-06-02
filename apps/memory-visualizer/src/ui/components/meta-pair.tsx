import type { ReactNode } from "react";

export interface MetaPairProps {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly mono?: boolean;
  readonly variant?: "stack" | "metric";
}

export function MetaPair({ label, value, mono = false, variant = "stack" }: MetaPairProps) {
  if (variant === "metric") {
    return (
      <article className="metric-card">
        <div className="meta-label">{label}</div>
        <div className={mono ? "metric-subtle mono" : "metric-subtle"}>{value}</div>
      </article>
    );
  }

  return (
    <div className="stack-row">
      <span className="meta-label">{label}</span>
      <span className={mono ? "mono" : undefined}>{value}</span>
    </div>
  );
}
