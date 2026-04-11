import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useDemo } from "../context/DemoContext";
import { tx } from "../utils/i18n";

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/intake": {
    title: "智能录单",
    subtitle: "",
  },
  "/quote": {
    title: "智能报价",
    subtitle: "",
  },
  "/procurement": {
    title: "智能询价",
    subtitle: "",
  },
};

export function Layout() {
  const location = useLocation();
  const meta = pageMeta[location.pathname] ?? pageMeta["/intake"];
  const { locale, setLocale } = useDemo();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth <= 1100) {
      setSidebarOpen((value) => !value);
      return;
    }
    setSidebarCollapsed((value) => !value);
  };

  return (
    <div className={sidebarCollapsed ? "workspace-shell is-collapsed" : "workspace-shell"}>
      <aside className={`${sidebarOpen ? "sidebar is-open" : "sidebar"}${sidebarCollapsed ? " is-collapsed" : ""}`}>
        <div className="sidebar__header">
          <div className="sidebar__masthead">
            <div className="sidebar__brand">
              <h1>Seabay AI Desk</h1>
              <span>{tx(locale, "内部控制台", "Ops Console")}</span>
            </div>
            <button
              className="sidebar-edge-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? "›" : "‹"}
            </button>
          </div>
        </div>

        <nav className="sidebar__nav">
          <NavLink to="/intake" onClick={() => setSidebarOpen(false)}>
            <span>01</span>
            <div>
              <strong>{tx(locale, "录单", "Intake")}</strong>
              <small>{tx(locale, "OCR 识别", "OCR parse")}</small>
            </div>
          </NavLink>
          <NavLink to="/quote" onClick={() => setSidebarOpen(false)}>
            <span>02</span>
            <div>
              <strong>{tx(locale, "报价", "Quote")}</strong>
              <small>{tx(locale, "价格表匹配", "Rate match")}</small>
            </div>
          </NavLink>
          <NavLink to="/procurement" onClick={() => setSidebarOpen(false)}>
            <span>03</span>
            <div>
              <strong>{tx(locale, "询价", "RFQ")}</strong>
              <small>{tx(locale, "机器人触达", "Robot outreach")}</small>
            </div>
          </NavLink>
        </nav>

        <div className="sidebar__footer">
          <div className="language-switch" aria-label="Language switch">
            <button
              className={locale === "zh" ? "language-switch__button is-active" : "language-switch__button"}
              onClick={() => setLocale("zh")}
              aria-label="Switch to Chinese"
            >
              中
            </button>
            <span className="language-switch__divider" aria-hidden="true">/</span>
            <button
              className={locale === "en" ? "language-switch__button is-active" : "language-switch__button"}
              onClick={() => setLocale("en")}
              aria-label="Switch to English"
            >
              EN
            </button>
          </div>
          <a
            className="sidebar__link"
            href="https://www.seabay.cn/"
            target="_blank"
            rel="noreferrer"
          >
            {tx(locale, "企业官网", "Seabay.cn")}
          </a>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <div className="workspace-main">
        <header className="workspace-header">
          <button className="sidebar-toggle" onClick={toggleSidebar} aria-label="Toggle navigation">
            {sidebarOpen ? "×" : "☰"}
          </button>
          <div>
            <h2>{tx(locale, meta.title, {
              "智能录单": "AI Intake",
              "智能报价": "Quotation",
              "智能询价": "RFQ",
            }[meta.title] ?? meta.title)}</h2>
            {meta.subtitle ? <p className="muted">{tx(locale, meta.subtitle, meta.subtitle)}</p> : null}
          </div>
        </header>

        <main className="workspace-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
