import type { ReactNode } from "react";

import { buildSourceQueryString } from "./api-client";
import { CapabilityBadge, SectionHeader } from "./components";
import { buildRouteUrl, NAVIGATION_GROUPS } from "./navigation";
import { statusSummaryText, statusSummaryTone } from "./routes/shared";

import type { DashboardSnapshot } from "../contracts/dashboard";
import type { AsyncState } from "./dashboard-data";
import type { RouteDefinition } from "./route-registry";
import type { ShellStatusModel } from "./status-model";
import type { SourceQueryConfig } from "./api-client";

export function AppShell({
  activeApiKey,
  activeRoute,
  children,
  onLogout,
  onNavigate,
  snapshotState,
  sourceQuery,
  statusModel,
}: {
  readonly activeApiKey: string | undefined;
  readonly activeRoute: RouteDefinition;
  readonly children: ReactNode;
  readonly onLogout: () => void;
  readonly onNavigate: (path: string) => void;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly sourceQuery: SourceQueryConfig;
  readonly statusModel: ShellStatusModel | null;
}) {
  return (
    <main className="app-shell">
      <div className="shell-frame">
        <ReadOnlyBanner />
        <section className="hero-panel" aria-labelledby="visualizer-title">
          <div className="hero-grid">
            <div>
              <div className="eyebrow">仅限本地的白盒可观测性</div>
              <h1 id="visualizer-title" className="hero-heading">
                TencentDB Agent Memory Visualizer
              </h1>
              <p className="hero-copy">
                 面向 Persona、Scene、Evidence 和 Offload 轨迹的渐进式查看界面。即使本地数据根目录不完整、缺失或部分降级，所有页面仍可继续导航。
              </p>
            </div>
            <div className="shell-panel">
              <div className="eyebrow">使用提醒</div>
              <p className="metric-subtle">
                  这个界面始终通过 <span className="mono">/api/*</span> 读取服务端 DTO。选择数据源只会改变本地只读查询，不表示会对本地数据做任何修改。
              </p>
              <div className="stack-row">
                <span className="meta-label">访问模式</span>
                <span>{activeApiKey ? "共享密钥已验证" : "本地免登录"}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">当前路由</span>
                <span>{activeRoute.label}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">数据源查询</span>
                  <span className="mono">{buildSourceQueryString(sourceQuery) || "默认查询"}</span>
              </div>
              {activeApiKey ? (
                <div className="form-actions auth-actions">
                  <button className="button" data-variant="ghost" type="button" onClick={onLogout}>
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="shell-panel" aria-label="主导航">
          <div className="nav-groups">
            {NAVIGATION_GROUPS.map((group) => (
              <section key={group.id} className="nav-group" aria-labelledby={`nav-group-${group.id}`}>
                <div className="nav-group-header">
                  <h2 id={`nav-group-${group.id}`} className="nav-group-title">
                    {group.label}
                  </h2>
                  <p className="nav-group-copy">{group.detail}</p>
                </div>
                {group.routes.length > 0 ? (
                  <div className="nav-list">
                    {group.routes.map((route) => (
                      <a
                        key={route.id}
                        className="nav-link"
                        href={buildRouteUrl(route.path, sourceQuery)}
                        aria-current={route.id === activeRoute.id ? "page" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(route.path);
                        }}
                      >
                        <span className="nav-title">{route.label}</span>
                        <span className="route-copy">{route.detail}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="nav-group-empty">
                    <span className="route-copy">本组保留给后续只读观测页面。</span>
                  </div>
                )}
              </section>
            ))}
          </div>
        </section>

        <section className="route-panel" aria-labelledby="route-heading">
          <SectionHeader
            eyebrow="当前页面"
            titleId="route-heading"
            title={activeRoute.label}
            action={statusModel ? <CapabilityBadge status={statusSummaryTone(snapshotState.data?.capabilityReport)}>{statusSummaryText(snapshotState.data?.capabilityReport)}</CapabilityBadge> : null}
          />
          <p className="route-copy">{activeRoute.detail}</p>
          {children}
        </section>
      </div>
    </main>
  );
}

export function ReadOnlyBanner() {
  return (
    <section className="readonly-banner" aria-label="只读模式横幅">
      <strong>只读模式</strong>
      <span>
        这个可视化界面只会通过应用内本地 API DTO 查看现有 Memory 产物。无论是导航、路径选择还是状态卡片，都不会把任何内容持久化回本地存储。
      </span>
    </section>
  );
}
