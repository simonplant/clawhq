/**
 * Base HTML layout for all dashboard pages.
 *
 * Server-rendered with Hono JSX. Uses Pico CSS for classless styling
 * and htmx for interactivity. Sidebar nav organized by lifecycle phase.
 */

import type { Child } from "hono/jsx";

interface LayoutProps {
  title?: string;
  children: Child;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

interface NavGroup {
  phase: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    phase: "Operate",
    items: [
      { label: "Dashboard", href: "/", icon: "\u25A3" },
      { label: "Doctor", href: "/doctor", icon: "\u2695" },
      { label: "Logs", href: "/logs", icon: "\u2263" },
      { label: "Alerts", href: "/alerts", icon: "\u25B2" },
      { label: "Fleet", href: "/fleet", icon: "\u2630" },
    ],
  },
  {
    phase: "Deploy",
    items: [
      { label: "Deploy", href: "/deploy", icon: "\u25B6" },
    ],
  },
  {
    phase: "Secure",
    items: [
      { label: "Secrets", href: "/secrets", icon: "\u26BF" },
    ],
  },
  {
    phase: "Evolve",
    items: [
      { label: "Skills", href: "/skills", icon: "\u2692" },
      { label: "Approvals", href: "/approvals", icon: "\u2713" },
    ],
  },
  {
    phase: "Plan",
    items: [
      { label: "Setup Wizard", href: "/init-wizard", icon: "\u2726" },
      { label: "Templates", href: "/templates", icon: "\u25A8" },
    ],
  },
];

function Sidebar() {
  return (
    <nav class="sidebar" aria-label="Main navigation">
      <header class="sidebar-header">
        <a href="/" class="sidebar-brand">
          <strong>ClawHQ</strong>
        </a>
      </header>
      {NAV_GROUPS.map((group) => (
        <details open>
          <summary>{group.phase}</summary>
          <ul>
            {group.items.map((item) => (
              <li id={item.href === "/fleet" ? "fleet-nav-item" : item.href === "/init-wizard" ? "wizard-nav-item" : undefined} style={item.href === "/fleet" ? "display:none;" : undefined}>
                <a href={item.href}>
                  <span class="nav-icon">{item.icon}</span>
                  {item.label}
                  {item.href === "/approvals" && (
                    <span id="approvals-badge" class="nav-badge" style="display:none;" />
                  )}
                  {item.href === "/fleet" && (
                    <span id="fleet-badge" class="nav-badge" style="display:none;" />
                  )}
                  {item.href === "/init-wizard" && (
                    <span id="wizard-badge" class="nav-badge" style="display:none;">NEW</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}

export function Layout({ title, children }: LayoutProps) {
  const pageTitle = title ? `${title} | ClawHQ` : "ClawHQ Dashboard";
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <link rel="stylesheet" href="/static/pico.min.css" />
        <script src="/static/htmx.min.js" defer />
        <style>{`
          :root {
            --sidebar-width: 220px;
          }
          body {
            display: flex;
            min-height: 100vh;
            margin: 0;
            padding: 0;
          }
          .sidebar {
            width: var(--sidebar-width);
            min-height: 100vh;
            padding: 1rem;
            border-right: 1px solid var(--pico-muted-border-color);
            position: fixed;
            top: 0;
            left: 0;
            overflow-y: auto;
          }
          .sidebar-header {
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--pico-muted-border-color);
          }
          .sidebar-brand {
            text-decoration: none;
            font-size: 1.25rem;
          }
          .sidebar details {
            margin-bottom: 0.25rem;
          }
          .sidebar summary {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--pico-muted-color);
            padding: 0.25rem 0;
          }
          .sidebar ul {
            list-style: none;
            padding: 0;
            margin: 0 0 0.5rem 0;
          }
          .sidebar li a {
            display: block;
            padding: 0.3rem 0.5rem;
            text-decoration: none;
            border-radius: 4px;
            font-size: 0.9rem;
          }
          .sidebar li a:hover {
            background: var(--pico-muted-border-color);
          }
          .nav-icon {
            margin-right: 0.5rem;
          }
          .nav-badge {
            margin-left: 0.4rem;
            padding: 0.05rem 0.4rem;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: #e76f51;
            color: #fff;
          }
          .main-content {
            margin-left: var(--sidebar-width);
            flex: 1;
            padding: 1.5rem 2rem;
            max-width: 1200px;
          }
          .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem;
            margin-top: 1rem;
          }
          .status-badge {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 600;
          }
          .status-running { background: #2d6a4f; color: #b7e4c7; }
          .status-stopped { background: #6c757d; color: #dee2e6; }
          .status-degraded { background: #e76f51; color: #fce4db; }
          .status-unknown { background: #495057; color: #adb5bd; }
          .status-valid { color: #52b788; }
          .status-expired { color: #e76f51; }
          .status-failing { color: #e63946; }
          .status-error { color: #e63946; }
          .status-missing { color: #adb5bd; }
          .metric-value {
            font-size: 1.5rem;
            font-weight: 700;
          }
          .metric-label {
            font-size: 0.8rem;
            color: var(--pico-muted-color);
          }
          .zero-egress {
            background: #2d6a4f;
            color: #b7e4c7;
          }
        `}</style>
      </head>
      <body>
        <Sidebar />
        <main class="main-content">
          {children}
        </main>
        <script>{`
          (function() {
            function refreshApprovalBadge() {
              fetch('/api/v1/approvals')
                .then(function(r) { return r.json(); })
                .then(function(res) {
                  if (!res.ok) return;
                  var count = res.data.filter(function(a) { return a.status === 'pending'; }).length;
                  var badge = document.getElementById('approvals-badge');
                  if (badge) {
                    badge.textContent = count > 0 ? count : '';
                    badge.style.display = count > 0 ? 'inline-block' : 'none';
                  }
                })
                .catch(function() {});
            }
            refreshApprovalBadge();
            setInterval(refreshApprovalBadge, 5000);

            function refreshFleetVisibility() {
              fetch('/api/v1/fleet')
                .then(function(r) { return r.json(); })
                .then(function(res) {
                  if (!res.ok) return;
                  var agents = res.data.agents || [];
                  var navItem = document.getElementById('fleet-nav-item');
                  if (navItem) {
                    navItem.style.display = agents.length > 1 ? 'block' : 'none';
                  }
                  var badge = document.getElementById('fleet-badge');
                  if (badge && agents.length > 1) {
                    badge.textContent = agents.length;
                    badge.style.display = 'inline-block';
                  } else if (badge) {
                    badge.style.display = 'none';
                  }
                })
                .catch(function() {});
            }
            refreshFleetVisibility();
            setInterval(refreshFleetVisibility, 10000);

            function refreshWizardVisibility() {
              fetch('/api/v1/status')
                .then(function(r) { return r.json(); })
                .then(function(res) {
                  var wizardItem = document.getElementById('wizard-nav-item');
                  var wizardBadge = document.getElementById('wizard-badge');
                  if (!wizardItem) return;
                  // Hide wizard link if agent is running (configured)
                  if (res.ok && res.data && res.data.agent && res.data.agent.state === 'running') {
                    wizardItem.style.display = 'none';
                  } else {
                    wizardItem.style.display = 'block';
                    if (wizardBadge) wizardBadge.style.display = 'inline-block';
                  }
                })
                .catch(function() {
                  // Show wizard if status unavailable (no agent configured)
                  var wizardItem = document.getElementById('wizard-nav-item');
                  var wizardBadge = document.getElementById('wizard-badge');
                  if (wizardItem) wizardItem.style.display = 'block';
                  if (wizardBadge) wizardBadge.style.display = 'inline-block';
                });
            }
            refreshWizardVisibility();
          })();
        `}</script>
      </body>
    </html>
  );
}
