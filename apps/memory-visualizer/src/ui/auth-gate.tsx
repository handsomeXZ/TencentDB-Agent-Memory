import type { FormEvent, ReactNode } from "react";

import { ReadOnlyBanner } from "./app-shell";
import { ErrorState } from "./components";

export function AuthGate({
  activeApiKey,
  authRequirement,
  children,
  loginBusy,
  loginError,
  loginKey,
  onLoginKeyChange,
  onLoginSubmit,
}: {
  readonly activeApiKey?: string | undefined;
  readonly authRequirement?: "unknown" | "required" | "not-required";
  readonly children?: ReactNode;
  readonly loginBusy: boolean;
  readonly loginError: string | null;
  readonly loginKey: string;
  readonly onLoginKeyChange: (value: string) => void;
  readonly onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (authRequirement && (authRequirement !== "required" || activeApiKey)) return <>{children}</>;

  return (
    <main className="app-shell">
      <div className="shell-frame">
        <ReadOnlyBanner />
        <section className="hero-panel auth-hero-panel" aria-labelledby="visualizer-title">
          <div className="hero-grid auth-hero-grid">
            <div>
              <div className="eyebrow">仅限本地的白盒可观测性</div>
              <h1 id="visualizer-title" className="hero-heading">
                TencentDB Agent Memory Visualizer
              </h1>
              <p className="hero-copy">
                这个只读界面仍会先加载 SPA 外壳，但数据读取继续受 <span className="mono">TDAI_VIS_API_KEY</span> 保护。输入共享访问密钥后，浏览器会对所有 <span className="mono">/api/*</span> 请求附带 Bearer 头，并继续保持只读边界。
              </p>
            </div>
            <form className="path-form auth-panel" onSubmit={onLoginSubmit}>
              <div className="eyebrow">访问验证</div>
              <h2 className="section-title">输入共享访问密钥</h2>
              <p className="field-hint">
                仅验证当前浏览器会话。退出登录会清除此会话缓存的密钥，不会改动任何本地 Memory 数据。
              </p>
              <label className="field">
                <span className="meta-label">共享访问密钥</span>
                <input
                  aria-label="共享访问密钥"
                  autoComplete="current-password"
                  disabled={loginBusy}
                  type="password"
                  value={loginKey}
                  onChange={(event) => onLoginKeyChange(event.target.value)}
                />
              </label>
              {loginError ? <ErrorState title="登录失败" detail={loginError} /> : null}
              <div className="form-actions auth-actions">
                <button className="button" disabled={loginBusy} type="submit">
                  {loginBusy ? "验证中..." : "登录并验证"}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
