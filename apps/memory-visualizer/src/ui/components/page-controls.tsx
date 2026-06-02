import type { DashboardPage } from "../../providers";
import type { PageRequest } from "../api-client";

export function PageControls(props: {
  readonly page: DashboardPage<unknown>;
  readonly busy: boolean;
  readonly onChange: (page: PageRequest) => void;
}) {
  const { page, busy, onChange } = props;
  const previousOffset = Math.max(0, page.offset - page.limit);
  const nextOffset = page.offset + page.limit;
  const end = Math.min(page.total, page.offset + page.items.length);
  const start = page.total === 0 ? 0 : page.offset + 1;
  return (
    <div className="page-controls">
      <div className="route-copy">
        当前显示第 <span className="mono">{start}</span> 到 <span className="mono">{end}</span> 条，共 <span className="mono">{page.total}</span> 条记录。
      </div>
      <div className="form-actions">
        <button className="button" type="button" disabled={busy || page.offset === 0} onClick={() => onChange({ offset: previousOffset, limit: page.limit })}>
          上一页
        </button>
        <button className="button" type="button" disabled={busy || nextOffset >= page.total} onClick={() => onChange({ offset: nextOffset, limit: page.limit })}>
          下一页
        </button>
      </div>
    </div>
  );
}
