# Can SepWiz replace AccuRIP Emerald?

**Not yet, and nothing in the product should suggest otherwise.** This document
exists to make the gap explicit rather than to plan around it.

A RIP is not one feature. It is a stack of responsibilities between the design
application and the film printer, and SepWiz currently covers roughly the top
half of it.

## What sits between Illustrator and the film printer

| AccuRIP responsibility | SepWiz capability | Missing | Validation required |
|---|---|---|---|
| Accept spot separations | Produces them — real `/Separation` plates | — | Emerald must accept our PDF |
| Halftone screening | AM screening, area-normalised, round/ellipse/square | FM/stochastic | Compare our dot to Emerald's on film |
| LPI control | Per-screen, 25–200 | — | Confirm ours matches at the same nominal LPI |
| Screen angles | Per-screen, overlap-aware assignment | — | — |
| Dot shape | Three shapes | Others Emerald offers | — |
| Film positive / negative | Positive; the renderer has a `negative` flag, unexercised | Negative not surfaced or tested | Ask which the shop uses |
| Rasterization to printer resolution | Renders to 300/600/1200 DPI | Not to a printer's *native* raster | Need the printer's true addressable resolution |
| Ink density / all-black output | **Not modelled** | Driving all printer channels to maximise opacity is a core RIP job and we do none of it | Blocking for direct output |
| Printer resolution handling | — | No printer model | Need Nick's printer |
| Media size and margins | Artboard only | No media model, no fit-to-media | — |
| Orientation / rotation | — | No rotation | — |
| Scaling | Exact, 100%, verified | — | — |
| Printer communication | **None** | No transport at all | — |
| Printer drivers / protocols | **None** | ESC/P2, PCL, raw sockets, CUPS — none implemented | — |
| Channel / ink control | **None** | Cannot address individual printer channels | Blocking for direct output |
| Registration marks | Yes, verified identical across plates | — | Confirm Emerald carries DeviceGray to all plates |

## The honest summary

SepWiz covers **separation, screening and film geometry**. It does not do
**rasterization to a device, ink density control, or printer communication** —
and those are precisely the parts that make a RIP a RIP.

The single biggest gap is **ink density / all-black output**. A film printer
driven naively lays down one channel of ink and produces a grey, translucent
positive that will not block UV. Emerald's real value is driving every
available channel to maximum density. We model none of that, and it cannot be
guessed — it depends on the printer, the ink and the media.

## What we should not do

- Do not implement speculative printer drivers.
- Do not claim printer support for any device that has not physically printed
  a usable film.
- Do not describe SepWiz as a RIP replacement in any UI copy.

## Sensible order, if this is pursued

1. **Capture Nick's exact setup** — printer, model, Emerald configuration,
   resolution, media, density settings. The Shop Test panel now collects this.
2. **Validate the spot PDF through Emerald.** This is the milestone that pays
   off immediately and carries no risk.
3. **Only then** consider whether direct output is worth attempting, and for
   which single printer.

The intermediate milestone — SepWiz → spot PDF → AccuRIP — removes Photoshop
channels and Illustrator from the workflow without touching the part that is
genuinely hard. That is where the value is right now.

---

## Nick's validated workflow

**Nothing has been validated yet.** This section exists so that the moment a
result arrives it has somewhere to go that is not a Slack message, and so that
the shape of the answer is agreed before anyone is tempted to round it up.

Fill this in from a completed `EMERALD-VALIDATION-CHECKLIST`, not from
recollection. The Emerald panel exports the same fields as JSON and CSV, and
`validatedWorkflowMarkdown()` in `src/lib/store/emerald.ts` renders the table
below directly from saved results.

| Question | Observed | Recorded by | Date |
|---|---|---|---|
| SepWiz file type accepted | — | — | — |
| Emerald import behaviour | — | — | — |
| Spot handling (plates, names) | — | — | — |
| Screening responsibility | — | — | — |
| Density behaviour | — | — | — |
| Printer path | — | — | — |
| Film result | — | — | — |

### The question this settles

Who applies the halftone screen. There are three possible answers and we do
not know which one is true:

- **A.** SepWiz outputs final screened film data and Emerald passes it through.
- **B.** SepWiz outputs continuous-tone spot plates and Emerald screens them.
- **C.** Emerald rescreens data SepWiz already screened.

C is the one to watch for. It is not a failure — the film may be perfectly
good — but it means our angles and dot shape are decorative, and every
screening control in the app is describing something the shop is not actually
getting. The validation package exports both modes side by side specifically
so this can be answered by comparison rather than by argument.

### What a passing result would and would not license

A completed checklist with no failures would let us say: *raster jobs can
bypass Illustrator in validated Emerald workflows.* It would say nothing about
replacing Emerald. The table at the top of this document is unchanged by any
Emerald result, because the responsibilities it lists — ink density, device
rasterization, printer communication — sit downstream of the file we hand over.

### Which Emerald responsibilities would remain

Every row in the table above marked **Not modelled** or **None** stays exactly
where it is. Validating the spot PDF removes Illustrator from the workflow. It
moves nothing out of the RIP.
