import type { ReactNode } from "react";

export type StateTone = "loading" | "warning" | "error" | "empty";

export interface StateCardProps {
  readonly tone: StateTone;
  readonly label?: string;
  readonly title?: ReactNode;
  readonly detail?: ReactNode;
  readonly children?: ReactNode;
}

export function StateCard({ tone, label, title, detail, children }: StateCardProps) {
  return (
    <article className="state-card" data-tone={tone}>
      {label ? <div className="meta-label">{label}</div> : null}
      {title ? <strong>{title}</strong> : null}
      {detail ? <div className="state-copy">{detail}</div> : null}
      {children}
    </article>
  );
}

export function LoadingState({ title, detail }: { readonly title: ReactNode; readonly detail: ReactNode }) {
  return <StateCard tone="loading" label="加载中" title={title} detail={detail} />;
}

export function ErrorState({ title, detail }: { readonly title: ReactNode; readonly detail: ReactNode }) {
  return <StateCard tone="error" label="错误" title={title} detail={detail} />;
}

export function WarningState({ title, detail }: { readonly title: ReactNode; readonly detail: ReactNode }) {
  return <StateCard tone="warning" label="告警" title={title} detail={detail} />;
}

export function EmptyState({ title, detail }: { readonly title: ReactNode; readonly detail: ReactNode }) {
  return <StateCard tone="empty" label="空状态" title={title} detail={detail} />;
}
