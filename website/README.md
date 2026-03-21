# claw-hq.com — Marketing Website

Static marketing site for ClawHQ. Serves at https://claw-hq.com.

## Files

```
website/
├── index.html     — Single-page marketing site
├── style.css      — Styles (dark theme, design system)
├── favicon.svg    — Paw print favicon
└── README.md      — This file
```

## Deploy

Any static host works. Recommended: Cloudflare Pages, Vercel, Netlify.

**Cloudflare Pages:**
1. Connect `simonplant/clawhq` repo
2. Build command: (none — static files)
3. Output directory: `website`
4. Custom domain: `claw-hq.com`

**Netlify:**
```toml
# netlify.toml
[build]
  publish = "website"
```

**Vercel:**
```json
// vercel.json
{
  "outputDirectory": "website"
}
```

**Serve locally:**
```bash
cd website && python3 -m http.server 8080
# open http://localhost:8080
```

## Design Decisions

- **No build step** — pure HTML/CSS, no bundler, no framework
- **Dark theme** — matches the product's terminal/developer audience
- **Single page** — all sections reachable by anchor links
- **No JS frameworks** — vanilla JS for copy button only
- **Responsive** — works on mobile down to 360px

## Content

Content is derived directly from:
- `README.md` — product positioning and architecture
- `docs/PRODUCT.md` — personas, day-in-the-life, principles
- `CLAUDE.md` — terminology, non-negotiables, core bet

Keep content in sync with docs when product messaging evolves.
