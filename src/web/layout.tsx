/**
 * Shared HTML layout for the web dashboard.
 *
 * Uses Pico CSS for minimal styling and htmx for interactivity.
 * All pages render server-side; htmx handles partial updates.
 */

import type { Child } from "hono/jsx";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/doctor", label: "Doctor" },
  { href: "/logs", label: "Logs" },
  { href: "/deploy", label: "Deploy" },
  { href: "/approvals", label: "Approvals" },
  { href: "/skills", label: "Skills" },
  { href: "/init", label: "Init Wizard" },
] as const;

export function Layout({
  title,
  activePath,
  csrfToken,
  children,
}: {
  title: string;
  activePath: string;
  csrfToken?: string;
  children: Child;
}) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} - ClawHQ Dashboard</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
          integrity="sha384-L1dWfspMTHU/ApYnFiMz2QID/PlP1xCW9visvBdbEkOLkSSWsP6ZJWhPw6apiXxU"
          crossorigin="anonymous"
        />
        <script
          src="https://unpkg.com/htmx.org@2.0.4"
          integrity="sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+"
          crossorigin="anonymous"
        ></script>
        <style>{`
          nav ul { list-style: none; padding: 0; display: flex; gap: 0.5rem; flex-wrap: wrap; }
          nav a { padding: 0.25rem 0.75rem; border-radius: 4px; text-decoration: none; }
          nav a[aria-current="page"] { background: var(--pico-primary-background); color: var(--pico-primary-inverse); }
          .check-pass { color: green; }
          .check-fail { color: red; }
          .check-warn { color: orange; }
          .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.85em; }
          .badge-ok { background: #d4edda; color: #155724; }
          .badge-err { background: #f8d7da; color: #721c24; }
          .badge-warn { background: #fff3cd; color: #856404; }
          .badge-pending { background: #cce5ff; color: #004085; }
          pre.log-output { max-height: 70vh; overflow-y: auto; font-size: 0.85em; }
          .htmx-indicator { display: none; }
          .htmx-request .htmx-indicator { display: inline; }
          .htmx-request.htmx-indicator { display: inline; }
        `}</style>
      </head>
      <body hx-headers={csrfToken ? JSON.stringify({ "X-CSRF-Token": csrfToken }) : undefined}>
        <header class="container">
          <nav>
            <ul>
              <li><strong>ClawHQ</strong></li>
            </ul>
            <ul>
              {NAV_ITEMS.map((item) => (
                <li>
                  <a
                    href={item.href}
                    aria-current={activePath === item.href ? "page" : undefined}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main class="container">{children}</main>
        <footer class="container">
          <small>ClawHQ Dashboard — browser UI over CLI-complete features</small>
        </footer>
      </body>
    </html>
  );
}
