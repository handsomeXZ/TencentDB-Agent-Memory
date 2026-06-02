import type { DashboardSnapshot } from "../../contracts/dashboard";
import type { SourceQueryConfig } from "../api-client";
import type { AsyncState } from "../dashboard-data";
import { ErrorState, LoadingState } from "../components";
import type { ShellStatusModel } from "../status-model";

export function SettingsRoute({
  snapshotState,
  statusModel,
  formState,
  onFormStateChange,
  onApplySourceSelection,
  onResetSourceSelection,
}: {
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly statusModel: ShellStatusModel | null;
  readonly formState: SourceQueryConfig;
  readonly onFormStateChange: (value: SourceQueryConfig) => void;
  readonly onApplySourceSelection: (value: SourceQueryConfig) => void;
  readonly onResetSourceSelection: () => void;
}) {
  return (
    <div className="route-grid">
      <PathConfigurationForm
        value={formState}
        onChange={onFormStateChange}
        onSubmit={onApplySourceSelection}
        onReset={onResetSourceSelection}
      />
      <section className="shell-panel">
        <h3 className="section-title">当前状态概览</h3>
        {snapshotState.status === "loading" ? <LoadingState title="正在加载数据源状态" detail="正在等待当前数据源 metadata。" /> : null}
        {snapshotState.status === "error" ? <ErrorState title="状态模型不可用" detail={snapshotState.error ?? "数据源状态请求失败。"} /> : null}
        {statusModel ? (
          <div className="detail-grid">
            <article className="metric-card">
              <div className="meta-label">数据源标签</div>
              <div className="metric-subtle">{statusModel.sourceLabel}</div>
            </article>
            <article className="metric-card">
              <div className="meta-label">数据根目录</div>
              <div className="metric-subtle mono">{statusModel.dataRoot || "未配置"}</div>
            </article>
            <article className="metric-card">
              <div className="meta-label">Offload 根目录</div>
              <div className="metric-subtle mono">{statusModel.offloadRoot || "未配置"}</div>
            </article>
            <article className="metric-card">
              <div className="meta-label">环境输入</div>
              <div className="metric-subtle mono">{statusModel.environmentInputs.join(", ") || "无"}</div>
            </article>
          </div>
        ) : null}
      </section>
    </div>
  );
}



function PathConfigurationForm({
  value,
  onChange,
  onSubmit,
  onReset,
}: {
  readonly value: SourceQueryConfig;
  readonly onChange: (value: SourceQueryConfig) => void;
  readonly onSubmit: (value: SourceQueryConfig) => void;
  readonly onReset: () => void;
}) {
  return (
    <form
      className="path-form"
      aria-label="路径配置表单"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="eyebrow">仅选择本地只读数据源</div>
      <h3 className="section-title">路径配置</h3>
      <p className="field-hint">
        通过查询路径选择，你可以查看配置根目录下的其他本地文件夹。这个界面只会更新读取查询，不会写入本地数据。
      </p>
      <div className="field-grid">
        <label className="field">
          <span>数据目录覆盖</span>
          <input
            name="dataDir"
            value={value.dataDir}
            onChange={(event) => onChange({ ...value, dataDir: event.target.value })}
            placeholder="example-subdir"
          />
        </label>
        <label className="field">
          <span>Offload 根目录覆盖</span>
          <input
            name="offloadRootPath"
            value={value.offloadRootPath}
            onChange={(event) => onChange({ ...value, offloadRootPath: event.target.value })}
            placeholder="offload/agent-planner"
          />
        </label>
        <label className="field">
          <span>数据源标签</span>
          <input
            name="sourceLabel"
            value={value.sourceLabel}
            onChange={(event) => onChange({ ...value, sourceLabel: event.target.value })}
            placeholder="local-memory"
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="button" type="submit">
          应用数据源选择
        </button>
        <button className="button" data-variant="ghost" type="button" onClick={onReset}>
          清除数据源查询
        </button>
      </div>
    </form>
  );
}

