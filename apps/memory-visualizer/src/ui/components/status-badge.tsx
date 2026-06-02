import type { ReactNode } from "react";

import type { CapabilityStatusValue } from "../../contracts/dashboard";

export interface StatusBadgeProps {
  readonly status: CapabilityStatusValue;
  readonly children: ReactNode;
}

export function CapabilityBadge({ status, children }: StatusBadgeProps) {
  return (
    <span className="capability-badge" data-status={status}>
      {children}
    </span>
  );
}

export function StatusBadge(props: StatusBadgeProps) {
  return <CapabilityBadge {...props} />;
}
