import type { ReactNode } from "react";

export interface TableHeaderRowProps {
  readonly label: ReactNode;
  readonly title: ReactNode;
  readonly action?: ReactNode;
}

export function TableHeaderRow({ label, title, action }: TableHeaderRowProps) {
  return (
    <div className="table-row">
      <div>
        <div className="table-label">{label}</div>
        <h3 className="table-heading">{title}</h3>
      </div>
      {action ?? null}
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  titleId,
  action,
}: {
  readonly eyebrow: ReactNode;
  readonly title: ReactNode;
  readonly titleId?: string;
  readonly action?: ReactNode;
}) {
  return (
    <header className="stack-row">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2 id={titleId} className="route-heading">{title}</h2>
      </div>
      {action ?? null}
    </header>
  );
}
