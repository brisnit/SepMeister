# Physical shop feedback — Nick

**Not a speculative backlog.** Every item below came from an experienced
separator using SepWiz on real artwork in a working screen-print shop. Where
something here contradicts an assumption in the code, the shop wins.

## Observed workflow (current, without SepWiz)

```
Photoshop channels → Illustrator → AccuRIP Emerald → film printer → burn → press
```

## Requests, in the order they came up

| # | Request | Status |
|---|---|---|
| 1 | High-resolution zoom into separations and films | **Done** — 25%–1600%, wheel/pinch, drag and spacebar pan, double-click, fit art/width/100%, pixel-preserving above 2× |
| 2 | Inspect tonal/mask coverage at a specific point | **Done** — coverage inspector reporting mask 0–255, coverage %, screening and expected dot area |
| 3 | Hover magnification | **Done** — loupe at 4×/8×/16× with crosshair, independent of canvas zoom |
| 4 | More flexible underbase control | **Done** — per-ink relationship, regenerate, remove |
| 5 | Remove underbase beneath individual colours | **Done** — Full / Reduced / None per ink, base recomputed without re-separating |
| 6 | Ability to remove the underbase completely | **Done** — with confirmation |
| 7 | T-shaped registration layout | **Done** — three targets across the top, one at bottom centre; lower corners removed |
| 8 | Thicker/bolder registration marks | **Done** — bold by default, bounded so the ring never closes and the cross centre stays exact |
| 9 | Move film production specs near the top-right registration mark | **Done** — job, screen number, ink, mesh, LPI, angle, size, scale |
| 10 | Explore a named spot-colour workflow | **Done** — real PDF `/Separation` plates, structurally verified |
| 11 | Explore eliminating Illustrator | **Researched** — see `direct-output-research.md` |
| 12 | Explore eliminating AccuRIP Emerald | **Researched, not attempted** — see `rip-replacement-research.md` |
| 13 | SepWiz as the whole separation-to-film prepress environment | Direction, not a milestone |
| 14 | Prove or disprove SepWiz -> Spot PDF -> Emerald -> film | **Package built, awaiting the shop** — see below |

## What Nick's feedback changed about our assumptions

**Lower-corner registration marks were a mistake.** They sit where the platen
and the operator's hands are. A mark you cannot see is a mark you cannot align
to. This was not something we would have discovered from a screen.

**Hairline registration marks were a mistake.** They are hard to see through
mesh under shop lighting. Weight matters more than delicacy.

**Specs at the bottom-left were in the wrong place.** A separator's eye lands
top-right as a film comes off the printer.

**"How transparent is this here?" is a first-class question.** We had built the
whole coverage model and given no way to read a single value off it.

## Terminology corrected as a result

The inspector reports **ink coverage** — the area fraction a screen lays ink
over. It does *not* report opacity. How opaque the printed result is depends on
ink, mesh, deposit and garment, none of which SepWiz models. Labelling coverage
as opacity would invite a separator to trust a number nobody computed.

## The open question: who does the halftoning?

Unanswered, and not answerable from a desk. There are three possibilities:

- SepWiz screens and Emerald passes the dots through.
- SepWiz sends continuous tone and Emerald screens it.
- SepWiz screens and Emerald rescreens anyway.

The third is the one worth watching for. It would not necessarily produce bad
film, but it would mean every screening control in the app describes something
the shop is not actually getting.

Both modes are exported side by side in the validation package precisely so
this is settled by comparison rather than by argument. Neither is treated as
the preferred answer anywhere in the product.

## Still to capture from the shop

Recorded through the Shop Test and Emerald panels, not guessed at:

- film printer manufacturer and model
- AccuRIP version and Emerald configuration
- output resolution
- media
- ink channel configuration, density settings, black ink strategy
- page size, halftone settings, any custom presets

Nothing about direct printer output should be built before those are known, and
nothing in the app should imply a printer is supported until a film from that
device has physically been produced.
