export interface JsonHintCardProps {
  readonly title: string;
  readonly value: unknown;
}

export function JsonHintCard({ title, value }: JsonHintCardProps) {
  return (
    <article className="table-card">
      <div className="table-label">{title}</div>
      <pre className="json-hint">{JSON.stringify(value, null, 2)}</pre>
    </article>
  );
}
