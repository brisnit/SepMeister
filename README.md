# Sep AI

Turns raster artwork into production-ready screen-print separations and
registration-matched black film positives.

The separation engine is deterministic image processing. No generative model
touches a pixel of the output: given the same artwork and the same settings it
produces byte-identical masks and byte-identical films.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Other commands:

```bash
npm test             # tests against the real engine, not mocks
npm run test:watch
npm run typecheck
npm run build        # production build
npm start            # serve the production build
```

No API keys, no environment variables, no services. Artwork is decoded and
separated entirely in the browser; nothing is uploaded to a server.

To try it without a file, click **Use demo artwork** — a nautical badge
generated from primitives with linework, flat spots, gradients, antialiasing
and alpha.

Nothing is persisted to a server. Presets, the current job and test-print
feedback live in this browser's localStorage; artwork never leaves the page.

---

## Shop workflow

1. **Drop artwork.** PNG, JPG, TIFF or WebP.
2. **Set the print size.** This is the important one — a 1200px file is a crisp
   4in print and a soft 14in one, and the app shows the effective resolution
   live and warns before it becomes a problem.
3. **Pick a press preset**, or set garment, screen limit, mesh and line count
   by hand. Presets are saved per browser and describe *your* press.
4. **Separate.**
5. **Inspect the underbase** — including an overlay on the original artwork,
   which is the first thing an experienced printer will want to see.
6. **Tune each screen**: mesh, LPI, angle, dot shape, choke, spread, coverage.
   Unsafe mesh/LPI combinations are flagged with a one-click fix, never blocked.
7. **Review** against the original — split, side-by-side or difference — with
   no production controls in the way, for showing a customer.
8. **Output check.** Job facts, every screen's settings, and a film QA report
   that only reports checks it actually ran.
9. **Download films**, or a **test package** that also carries the original
   artwork and a full job manifest for documenting a press test.
10. **Record what happened** on press in the feedback panel, and export it as
    JSON.

---

## Architecture

The engine is pure TypeScript over `Uint8ClampedArray` RGBA buffers. That one
decision buys four things: it runs in a Web Worker so the UI never blocks, it
runs headless in Node so the tests exercise the real engine rather than a mock,
it is deterministic, and it deploys to Vercel as static output with no
image-processing runtime.

```
src/
  lib/
    color/space.ts        sRGB <-> LAB (D65), CIEDE2000
    engine/
      analyze.ts          dominant colors, edges, gradients, artwork character
      printOrder.ts       print-order heuristic, shared by engine and UI
      cluster.ts          weighted k-means++ in LAB, elbow estimation, merging
      masks.ts            soft-membership masks, despeckle, coverage union
      underbase.ts        underbase build, choke, strength, black knockout
      black.ts            black classification, garment-as-black assessment
      morphology.ts       erode/dilate/blur/levels, components, Sobel
      halftone.ts         AM screening, normalized threshold matrices
      composite.ts        area-weighted ink model
      metrics.ts          mean dE2000, SSIM, similarity score
      qa.ts               Sep Score heuristics
      naming.ts           ink names from color
      pipeline.ts         orchestration; the whole separation
      decode.ts           validation, sniffing, downscale (pure)
      browserDecode.ts    TIFF (utif) + platform bitmap decoding
    film/
      layout.ts           artboard geometry + registration marks
      png.ts              deterministic PNG encode/decode
      render.ts           mask -> film positive
      resample.ts         film-resolution rasterization
      filmQa.ts           deterministic pre-export checks
      pdf.ts              film, proof and production-sheet PDFs
      bundle.ts           ZIP export + job manifest
    production/size.ts    physical size, effective DPI, sheet fit
    store/                localStorage: presets, session, account, feedback
    ai/operations.ts      structured operations + provider seam
    demo/artwork.ts       generated test artwork
  worker/                 separation worker + typed protocol
  components/             UI
tests/                    engine, film, QA, storage and production tests
```

### How a separation is produced

1. **Analyze** — luminance, Sobel edges, gradient ratio, transparency,
   background detection, unique colors, artwork character.
2. **Cluster** — weighted k-means++ over a binned LAB histogram. Antialiased
   edge pixels are down-weighted, because a blend between two inks is an
   artifact of rasterization, not a color the artist chose.
3. **Reduce** — merge perceptually identical clusters (ΔE2000 < 6), drop
   insignificant ones, then merge the least valuable inks until the screen
   budget is met. Every decision is recorded and explained.
4. **Knock out** — clusters within ΔE 10 of the garment are supplied by the
   garment and cost no ink. The garment competes as a cluster during mask
   generation, so pixels that match it correctly receive nothing.
5. **Mask** — inverse-distance membership over the K nearest inks.
6. **Underbase** — union of ink coverage, choked by a resolution-aware
   distance, optionally pulled out from under black.
7. **Compose and score** — area-weighted reconstruction, ΔE2000 + SSIM
   similarity, Sep Score heuristics.

### Resolution: two numbers, deliberately kept apart

**Artwork detail** is `pixels ÷ print width` — how much real information exists.
**Film output** (300/600/1200 DPI) is how finely halftone dots are rasterized.
Raising the second never creates detail the first does not have, and conflating
them is how people come to believe a 90 DPI file became a 1200 DPI film. Both
are shown separately, everywhere.

Only *screened* films are resampled to the film raster. A solid film is the
same shape at any resolution, so upsampling one costs time and bytes and buys
nothing — at 12in/600 DPI that would be a 52-megapixel buffer per screen for no
benefit. Films of differing pixel dimensions still register exactly, because
physical placement comes from the shared layout, not from the raster.

### Two decisions worth knowing about

**Masks use inverse-distance weighting, not a Gaussian.** A Gaussian assigns
membership by absolute distance, so two inks that merely sit close together in
LAB — cream and white, ~15 units apart — bleed into each other everywhere,
laying a low-density haze of white over every cream pixel and wasting a screen.
Inverse-distance weighting is scale-free: a pixel sitting on an ink gets that
ink at full coverage regardless of how crowded the palette is, and a pixel
halfway between two inks splits 50/50. It is also *exact* for the case that
dominates real artwork — an antialiased edge is a linear blend of two inks, and
with K=2 the recovered weights are precisely the blend fractions.

**The composite mixes inks by area, not source-over.** A mask value is area
coverage, not opacity: where two screens each carry 50%, the press lays
interleaved halftone dots side by side, not one ink atop the other.
Compositing those sequentially gives the later screen undue weight and destroys
every blended edge. Switching to area-weighted mixing took the demo badge from
91% to 96% similarity and a flat two-color logo to a literal 100%.

---

## Registration

Every film in a job shares one `FilmLayout`, computed once. There is no code
path that can compute a mark position per-film, which is what makes the
guarantee structural rather than a matter of care.

Each film carries 8 registration targets (4 corners, 4 mid-edges), 4 center
marks, 8 crop marks, and a label with screen number, ink, mesh, job, size and
scale. All marks live in the margin band, clear of the artwork.

This is verified two ways: `tests/film.test.ts` asserts the PDF drawing
operators for the marks are byte-identical across every film in a bundle, and
the films were rendered and pixel-compared — all 8 targets matched exactly
across all screens.

Print at 100%. Never "fit to page".

---

## Screen counts

Every count from **1 to 18**, plus no-limit (which resolves to 24). Deliberately
a full range rather than a curated set: a one-colour print is an ordinary job,
and so is a fourteen-colour one on an automatic. Production shops run 12-, 16-
and 18-station presses, and a job on one of those is not an edge case.

A one-screen job on a dark garment prints the ink and lets the garment show
through everywhere else — the underbase is dropped rather than returning two
screens against a one-screen limit.

Two consequences worth knowing:

**Angle reuse is unavoidable past about six screens.** Only about six angles fit
inside 90 degrees at a usable spacing. Which screens share an angle is decided
from *measured overlap*, so reuse lands on pairs that never touch.

**Moire warnings are overlap-aware.** Raw angle proximity on a 16-colour job
flags roughly eighteen pairs, nearly all of which never meet on the shirt —
which trains an operator to ignore the one that mattered. Sep AI measures the
shared area and only warns when two screened inks genuinely overlap. In
practice spot separations are largely disjoint by construction, so a correct
16-screen job usually reports none.

Screen Efficiency scores *waste*, not count: near-duplicate inks, inks covering
almost nothing, and credit for garment knockout. A 16-screen job on a
16-station press is what the press is for. Registration Risk does still rise
with screen count — every extra screen is one more alignment that has to hold —
but it saturates rather than zeroing the score on any large job.

## Halftones

Screening is per-screen, because that is how it actually works: an underbase is
normally printed solid, and a detail black often runs a different line count and
angle from the colours. Each separation carries its own enable, LPI, angle and
dot shape.

Angle sets are offered as named conventions — a 45° spot family, a
process-style set, and all-on-one-angle — with their reasoning, and every screen
can be overridden. There is no universally correct set, and the UI says so.

Mesh/LPI guardrails use the common guideline that mesh should be roughly four
times the line count. Exceeding it produces a warning with a one-click **Apply
recommendation** that either raises mesh or pulls the line count into range.
Nothing is ever blocked; a separator with a reason to run 65 LPI on 110 mesh
can do exactly that.

## Film QA

Run before anything downloads. Every check inspects real state — the shared
layout object, the actual rendered rasters, the plan the production sheet is
built from:

- every film generated
- identical artwork bounds and physical placement
- registration marks present, identical, and clear of the artwork
- artboard matches the requested print size at 100%
- aspect ratio not stretched
- labels clear of artwork and marks (measured with the same fonts the renderer uses)
- monochrome output — screened masks are actually screened and inspected byte
  by byte; solid films are reported as single-channel rather than claimed to be
  binary
- halftone settings valid and resolvable at the film resolution
- output resolution, and whether it was capped

Nothing is reported as verified unless it was genuinely tested. A green tick
that means "we assumed this" is worse than no tick at all.

## Product state

There is no billing, no signup and no gating. `src/lib/store/account.ts`
defines the tier shapes (`FREE`, `PAY_PER_JOB`, `CREATOR`, `SHOP`, `PRO`) and
their entitlements so a credit model has somewhere to land, and counts
separations completed locally. `ENFORCE_ENTITLEMENTS` is hard `false`; turning
it on is a deliberate future step.

## What the AI layer does

It converts natural language into **structured operations** from a closed set
(`SeparationOperation`), which the deterministic engine executes. It cannot
hand back pixels.

The shipped provider is a local deterministic parser — no network, no key, no
nondeterminism. A hosted model can be dropped in behind the same
`SepAiProvider` interface without the separation engine changing at all.

Commands it handles: screen-count changes, garment color, garment-as-black,
underbase choke/strength/highlight, ink removal and merging, per-ink strength,
mesh targets, and halftone settings. Anything it does not recognise is reported
as not understood rather than guessed at — a wrong guess silently changes a
press-bound separation.

Asking it to "add more detail to the face" returns an explanation that
separations are derived from the artwork's own pixels, and suggests more
screens, finer mesh, or higher-resolution artwork.

---

## Export

`DOWNLOAD FILMS` produces a ZIP:

```
01-white-underbase.pdf …    film positives, black artwork on white
png/01-white-underbase.png  same films as raster, with DPI
composite-proof.pdf         full-color proof
production-sheet.pdf        shop summary, with per-screen halftone settings
job-manifest.json           machine-readable record of every decision
README.txt                  print order and warnings, readable at the burn table
```

**Download test package** adds `original-artwork.png`, so one archive documents
a physical press test end to end.

Film PDFs place the separation at an exact rectangle derived from physical
inches, so the raster cannot accidentally rescale the artwork. Marks and type
are vector. Export at 300, 600 or 1200 DPI.

Actual exposure, dot gain and registration behaviour depend on your printer,
RIP and press.

---

## Limitations

- **Sep Score is heuristic.** It encodes common failure modes; it is not
  trained on production outcomes. Treat it as a checklist.
- **Similarity is digital.** It measures how faithfully the separations
  reproduce the artwork as pixels. It does not predict a physical print.
- **The composite is not an ink simulation.** No opacity curves, mesh gain,
  dot gain, ink modification or flash behaviour.
- **Halftones are AM only.** FM/stochastic screening is not implemented; the
  module has a `ScreenFunction` seam for it.
- **Angle recommendations are conventions, not standards.** Different shops,
  presses and RIPs settle on different sets.
- **Mesh/LPI guardrails are heuristics** from the mesh:LPI ratio rule of thumb.
  Your press may handle combinations they flag. Identical combinations are
  grouped into one warning so a large job stays scannable.
- **Overlap-aware moire detection is measured, not simulated.** It reports
  where two screened inks share area at similar angles; whether that actually
  beats depends on ink opacity, mesh and dot shape.
- **Artwork above ~4 megapixels is downscaled** for interactive work. The UI
  shows the working size.
- **CMYK TIFFs are not colour-managed** — they are read through utif's RGBA
  conversion without an ICC transform.
- **The artwork raster is not persisted.** A production file is tens of
  megabytes and would blow the localStorage quota, so a restored session brings
  back everything except the image and says so plainly.
- **No accounts or server storage.** Presets, session and feedback are local to
  one browser.
