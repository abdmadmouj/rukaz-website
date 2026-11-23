# RUKAZ website

The RUKAZ site: a glass sculpture that rebuilds itself as you scroll, the story in English
and Arabic, and the introduction forms.

## Run it

```bash
npm install
SITE_URL=https://your-domain npm run build   # site into dist/ (pre-rendered / and /ar/), server into dist-server/
npm start          # http://localhost:8080
npm test           # physics, forms, layouts, server security
npm run typecheck
```

Requires Node 20 or later.

## Going live (GitHub Pages, rukazventures.com)

The site is published by GitHub Pages. Every push to `main` runs the checks and, if they
pass, builds the site (`STATIC=1`, for plain file hosting) and publishes it. A push that
breaks a check is not published, so the live site stays as it was.

**One-time setup**

1. In the repository on GitHub: Settings → Pages → Source: **GitHub Actions**.
2. At the domain provider for rukazventures.com, add these records:
   - `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `AAAA` records for `@`: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - `CNAME` record for `www`: `<your-github-name>.github.io`
3. Settings → Pages → Custom domain: `rukazventures.com` (the build also writes the `CNAME`
   file), then tick **Enforce HTTPS** once GitHub offers it (it can take up to a day).
4. Send one introduction from the live site. FormSubmit emails an activation link to
   info@rukazventures.com; click it once, and every introduction arrives there from then on.

**Forms on GitHub Pages.** Introductions are emailed to the address in `src/config/brand.ts`
(`forms.email`) through FormSubmit. To use Web3Forms instead, create an access key for
info@rukazventures.com at web3forms.com and put it in `forms.web3formsKey`. The page carries
its own security policy (scripts, styles and fonts from the site only; the form service is the
one outside address it may contact). Bots are filtered by a hidden field and a minimum fill time.

**Updating the site.** Change the copy in `src/content/en.ts` and `src/content/ar.ts` (or any
other file), commit to `main`, and the site updates by itself in a few minutes. Watch progress
under the repository's **Actions** tab.

**Running it on a Node server instead** (for example Render): `SITE_URL=https://rukazventures.com npm run build`,
then `npm start`, with `RUKAZ_WEBHOOK_URL` and `RUKAZ_WEBHOOK_SECRET` for the forms. The server
adds stricter headers (no framing, HSTS) and its own rate limit.

## Search, sharing and reading without scripts

The build writes the whole page as real HTML in English (`/`) and Arabic (`/ar/`), then the
script brings it to life. Search engines, link previews and screen readers get every
section before any script runs. Each page carries its title, description, hreflang links
and a share image (`public/images/share.jpg`, 1200×630) for LinkedIn, WhatsApp and X. Set
`SITE_URL` when building production so canonical links, share links and the sitemap use your
domain; without it, share links are relative and some apps will not show the picture.
Switching language on the live site updates the address to match.

## Settings (environment)

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 8080). |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to send forms, e.g. `https://rukaz.com,https://www.rukaz.com`. Required in production. |
| `RUKAZ_WEBHOOK_URL` | HTTPS address that receives each accepted introduction as JSON (an automation tool, CRM or mail service). Until this and the secret are set, the forms say plainly that online sending is not connected and offer to save a draft or download a copy. |
| `RUKAZ_WEBHOOK_SECRET` | Shared secret. Every delivery carries `x-rukaz-signature: sha256=<HMAC of the body>`; the receiver must check it. Keep it out of the repository. |
| `TRUST_PROXY=1` | Set only behind a proxy you control (it makes the rate limit use `X-Forwarded-For`). |
| `NODE_ENV=production` | Turns on HSTS and `upgrade-insecure-requests`. `npm start` sets it. |

## Security

- **Headers on every response:** a strict Content Security Policy (scripts, styles, fonts, images and connections from this origin only; no inline scripts; no framing), HSTS in production, `nosniff`, a strict referrer policy, a locked-down Permissions-Policy, and same-origin opener and resource policies.
- **No third parties.** Fonts, images, sound and code are served from the site or made in the browser. The site sets no cookies and loads no analytics.
- **Forms are re-checked on the server** with the same rules the page uses (`src/forms/schema.ts`): known fields only, length limits, valid choices, no control characters or line breaks in single-line fields (so nothing can be injected into mail headers), and https-only links.
- **Abuse limits:** a 16 KB body cap, a 10-second read timeout, JSON only, an origin check, five tries per address per ten minutes and sixty a minute overall, a hidden honeypot field and a minimum fill time. Bots get a quiet success and nothing is sent.
- **Delivery** is a signed HTTPS POST with an 8-second timeout and no redirects. Answers are HTML-escaped in the `html` field. Nothing is stored on the server.
- **The status endpoint** says only whether sending is set up.
- **Static files** cannot escape `dist/` (path traversal is refused), and only GET and HEAD are served.
- The rate limiter keeps counts in memory. That suits one server; with several, plug a shared store into `RateStore` (`server/security.ts`).

## How the sculpture works

| Part | File |
| --- | --- |
| All numbers that shape it (sizes, materials, light, cameras, physics) | `src/config/artDirection.ts` |
| The forms: ribbon, two halves, core sample, four gates, rising column, ledger, the mark | `src/scene/layouts.ts` |
| Storyboard, transitions and automatic camera framing | `src/scene/choreography.ts` |
| Physics: plates are solid slabs that touch and push aside | `src/scene/physics/plateWorld.ts` |
| The scene each frame (choreography, physics, pointer, render) | `src/scene/RukazScene.ts` |
| Sound (off by default; rings when the pointer reaches a plate; scrolling is silent) | `src/sound/` |

**Physics, honestly stated.** Plates are solid and drawn at exactly the size they collide at.
For every transition the plates are matched to the new slots by optimal matching (the
Hungarian method, `src/scene/assignment.ts`), so plates moving together keep clear of each
other; each then slides into its slot along a clear path. Fast plates take finer physics
steps, so nothing can skip through anything. A plate that stays blocked swaps slots with the
plate in its way when that shortens both journeys, or shrinks to a small shard that slips
through the gaps and grows back once seated. `tests/transitions.test.ts` runs every
transition on the page through the same physics: full-size plates never overlap by more
than 4 cm (in practice under 3.6 cm), a shard may graze a neighbour by a few centimetres at
the very end, and every form finishes (within about two seconds of stopping on a section: the physics runs 1.8 times faster than the clock, with the same contacts and checks).

**Layout and motion.** One scene per screen. Each section holds the screen while its words
come in, stay and leave with the scroll (Apple style, scrubbed, transform and opacity only);
the plates rebuild while the next section rises. The sculpture sits centred in the upper half
and is framed automatically to end just above that section's words (the page measures them),
so nothing is ever written over the plates. Buttons share one frosted glass panel. The hero
enters once on load. On phones and with reduced motion the words simply stand, on a frosted
panel below the sculpture. Design rules follow the taste skill (one section per screen, equal
edges, no fade-in on every block, quiet hover and press states); its copy linter passes with
no warnings.

## Light and dark

A small settings button in the header holds the language (English or Arabic) and the theme
(light or dark). Light is the default; dark stays one tap away. The choice is kept on the visitor's device only
(`localStorage`, no cookie) and set on `<html data-theme>`; the stylesheet's light tokens and
the 3D studio (`artDirection.themes`: backdrop, floor, fog, exposure) both follow it. In the
light theme the footer reverses to dark.

## Content

All copy lives in `src/content/en.ts` and `src/content/ar.ts`. The Team section and its menu
link stay hidden until `team.published` is set to `true` (after the team photography).

### Decisions still open (lines marked CONFIRM in the copy)

1. Operate as gated months instead of the 6-month retainer minimum.
2. "We take a small stake and earn it" replacing "Our own team and equity go in".
3. Time boxes for Plan it, Launch it and Make it last (shown as "Agreed at the gate before").
4. The reply promise: "We reply within two working days".
5. Confidentiality wording on the Groups form, checked by a lawyer.
6. Client sectors and numbers for the two case cards, once each client agrees.

## Fonts

Neue Haas Grotesk is the brand face, but the trial licence forbids web embedding, so the site
uses a locally installed licensed copy if present and otherwise Inter Tight (OFL). Almarai
(OFL) is used for Arabic. Add the licensed web fonts to `src/styles/site.css` once bought.
