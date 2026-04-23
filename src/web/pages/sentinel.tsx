/**
 * Sentinel pricing and signup page — revenue validation.
 *
 * Standalone page accessible without authentication. Presents the
 * Sentinel value proposition and accepts email signups for the
 * waiting list / subscription.
 */

export function SentinelPricingPage({ csrfToken }: { csrfToken: string }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Sentinel — Upstream Intelligence for OpenClaw | ClawHQ</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
      </head>
      <body>
        <main class="container">
          <hgroup>
            <h1>Sentinel</h1>
            <p>Upstream intelligence that a cron job can't replicate.</p>
          </hgroup>

          <section>
            <h2>Know before you update</h2>
            <p>
              Sentinel monitors the OpenClaw upstream repository and pre-computes
              whether a new release would break <strong>your specific config</strong>.
              Not a generic changelog — a breakage prediction against your actual
              deployment.
            </p>
          </section>

          <div class="grid">
            <article>
              <header><h3>Config Breakage Alerts</h3></header>
              <p>
                Before you run <code>clawhq update</code>, Sentinel tells you exactly
                what would break — which config keys changed, which defaults shifted,
                which tools were deprecated — mapped against your deployment.
              </p>
            </article>

            <article>
              <header><h3>CVE Tracking</h3></header>
              <p>
                New CVEs mapped to your specific skill and tool inventory. Not a
                generic advisory — a targeted alert for the packages you actually use.
              </p>
            </article>

            <article>
              <header><h3>Dependency Monitoring</h3></header>
              <p>
                When upstream dependencies of your installed skills change, you hear
                about it before a silent failure. Breaking changes in skill APIs
                caught before they reach your agent.
              </p>
            </article>

            <article>
              <header><h3>Fleet Intelligence</h3></header>
              <p>
                Anonymized health signals aggregated across the ClawHQ fleet. Identify
                emerging issues before they hit your deployment — patterns that no
                single instance can detect.
              </p>
            </article>
          </div>

          <section>
            <h2>Why not a cron job?</h2>
            <p>A local <code>clawhq doctor --watch</code> in cron can check your agent's health. It cannot:</p>
            <ul>
              <li>Cross-reference upstream commits against <strong>your</strong> config fingerprint</li>
              <li>Map CVEs to <strong>your</strong> installed skills and tools</li>
              <li>Detect breaking changes <strong>before</strong> you pull the update</li>
              <li>Aggregate patterns across thousands of deployments to spot emerging issues</li>
            </ul>
            <p>
              The value is <strong>upstream intelligence</strong> — computed on infrastructure
              you don't operate, against data you don't have locally.
            </p>
          </section>

          <section>
            <h2>Privacy</h2>
            <p>
              Sentinel receives a <strong>config fingerprint</strong> — structural metadata
              about which config keys are set, which tools are enabled, which channels are
              configured. Never values. Never credentials. Never content.
            </p>
            <p>
              Run <code>clawhq cloud sentinel fingerprint</code> to see exactly what Sentinel sees.
            </p>
          </section>

          <hr />

          <section>
            <h2>Pricing</h2>
            <div class="grid">
              <article>
                <header><h3>Free</h3></header>
                <p><strong>$0/mo</strong></p>
                <ul>
                  <li>Local upstream checks via GitHub API</li>
                  <li>CLI-only alerts</li>
                  <li>Manual check: <code>clawhq cloud sentinel check</code></li>
                </ul>
                <footer>
                  <code>clawhq cloud sentinel connect</code>
                </footer>
              </article>

              <article>
                <header><h3>Pro</h3></header>
                <p><strong>~$19/mo</strong></p>
                <ul>
                  <li>Everything in Free</li>
                  <li>Automatic monitoring (no manual checks)</li>
                  <li>Webhook + email alerts</li>
                  <li>CVE tracking per blueprint</li>
                  <li>Skill dependency monitoring</li>
                  <li>Fleet health intelligence</li>
                  <li>Priority alert delivery</li>
                </ul>
                <footer>
                  <form method="post" action="/sentinel/signup">
                    <input
                      type="email"
                      name="email"
                      placeholder="you@example.com"
                      required
                    />
                    <input type="hidden" name="csrf_token" value={csrfToken} />
                    <button type="submit">Join waitlist</button>
                  </form>
                </footer>
              </article>
            </div>
          </section>
        </main>

        <footer class="container">
          <p>
            <small>
              ClawHQ — the sovereign operations platform for OpenClaw.
              Your agent, your hardware, your data.
            </small>
          </p>
        </footer>
      </body>
    </html>
  );
}

/** Signup confirmation fragment. */
export function SignupConfirmation({ email }: { email: string }) {
  return (
    <article>
      <header><h3>You're on the list</h3></header>
      <p>We'll notify <strong>{email}</strong> when Sentinel Pro launches.</p>
      <p>
        In the meantime, try the free tier:<br />
        <code>clawhq cloud sentinel connect</code>
      </p>
    </article>
  );
}
