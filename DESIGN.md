# Design

Visual system "Signal" for the Rinne web surfaces (`rinne-web`). Scene: a
forensic instrument in a quiet lab, recording its findings in ink on paper;
the page itself sits on real footage of blue ink blooming through water,
washed back to cream. Light theme is the working environment. The instrument
is calm by design — one red needle moving is the only drama.

## Vocabulary

Rinne is a guard, not a judge. The system nouns are **decision**, **gate**,
**agent**, and **evidence** — never "verdict", "run", or "trace". An agent
sends a planned action; Rinne returns a decision whose **gate** is `proceed`,
`block`, or `review`, backed by the **evidence** that justified it (live Surf
market price, live Nansen address risk). Copy never overstates that evidence:
a `review` means something could not be verified, not that something is wrong.
This follows PRODUCT.md's honest-labels principle — the UI never upgrades the
claim the engine recorded. Use plain instrument language ("blocked", "could
not verify", "stale price"), never accusation.

## Color

Flat, committed, hex. One blue carries the brand; red is reserved for a
`block` gate and the failed critical rule behind it. No gradients anywhere.

- `--bg`          #fffdf8                — warm cream page
- `--card`        rgba(255,255,255,.88)  — translucent panels (ink ghosts through)
- `--ink`         #181610                — primary text
- `--ink-dim`     #5d5a4f                — secondary text (AA on cream)
- `--line`        #e8e4d8                — hairlines, borders
- `--blue`        #1d59f2                — brand: CTAs, links, `proceed`, emphasis
- `--blue-press`  #1747c8                — hover/press shade for blue pills
- `--blue-deep`   #122a75                — dark block sections (at .93 alpha)
- `--blue-pale`   #e8eefe                — chips, code pills
- `--blue-mist`   #b9c6ee                — secondary text on the blue-deep block
- `--red`         #e8442e                — `block`, the critical failure
- `--red-deep`    #a32014                — emphasis on hard failure
- `--amber`       #b25e06                — `review` / warn (dark enough for cream)
- `--steel`       #6d7480                — neutral / unknown

Gate mapping (always paired with the word): proceed → blue, block → red,
review → amber. A gate is never colour alone — dot plus word, always — so the
table, the agent rail, and the decision readout feel like one instrument.

A dark variant (`<html class="dark">`) re-paints the same committed-blue
system on deep ink-navy paper; only the paper, ink, and chips flip.

## The field

Every page sits on the same living background (`<InkField />`): self-hosted
footage of blue ink spreading through water (`public/media/ink-1280.webm`,
with `ink-1280.mp4` fallback; attribution in `public/media/ATTRIBUTION.txt`),
under a cream wash (`rgba(255,253,248,.76)`; `.88` calm variant for product
pages) with graph-paper rules drawn on top of the wash. Cards are translucent
so the ink visibly drifts beneath them; the blue-deep block sections run at
.93 alpha so the liquid keeps moving under the dark moments too. Footage
pauses on the first frame under `prefers-reduced-motion`.

## Typography

- Everything: Bricolage Grotesque (variable). Display 700–800, body 400–500.
- Data: Spline Sans Mono (variable), strictly for evidence: prices, hashes,
  block numbers, rule ids, gate words, small labels. Tabular figures on all
  numbers.
- Hero scale: clamp(56px, 10.5vw, 132px), line-height 0.98, tracking
  -0.035em; type is the illustration. Section headings 34–52px at -0.025em.

## Motifs

- The strike: a red line drawn through the bad data (`.strike`), rotate -2deg
  — used where copy contrasts an action Rinne would block.
- The rebirth dial: two dashed circles turning slowly behind hero moments
  (`.dial`), the cycle-of-rebirth loop as an instrument bezel.
- The story-thread: marching dashed line running through the landing beat
  cards (`.thread`), ink early, red at the moment a gate would `block`.
- The receipt: a tilted floating ticket (`.tilt`) with mono rows showing a
  recorded decision and its evidence; marketing artifact = product output.
- Chunky story cards: 2px ink borders + 4px offset solid shadows; quiet
  product panels: 1px `--line` borders, no shadow. The tiers never mix.

## Motion

- CSS-first (keyframes in index.css), ease `cubic-bezier(0.22,1,0.36,1)`.
- Continuous, slow, ambient: the ink footage, dial rotation (90–130s),
  thread march (1.4s loop), receipt hover-tilt (7s alternate).
- One-shot: the strike draws once at ~1.1s. No scroll-gated content.
- Everything has a reduced-motion fallback (static final frame).

## Layout

- Landing: centered single-column folds, max-w-[1160px], 28px gutters.
  Hero → get-started curl → how-the-guard-works (three moves: install &
  register, guard, decision) → scope → blue block → footer.
- App (`/app`): observe-only dashboard. Sticky translucent nav (BrandMark +
  wordmark), agent list and decision views; registration is agent-initiated,
  never via the UI. The decision readout leads with a hero gate lamp.
- Radii: 20px cards, 24px receipts, 36px block sections, pills for all
  actions. Buttons are pills, full stop.
