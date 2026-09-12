# Can SepWiz eliminate Illustrator?

Nick's current path is:

```
Photoshop channels → Illustrator → AccuRIP Emerald → film printer
```

The question is what Illustrator is actually contributing between Photoshop
and the RIP, and whether SepWiz already covers it.

## What Illustrator is doing in this workflow

Illustrator is not being used as a drawing tool here. In a
channels-to-RIP path it is doing document assembly:

1. **Importing spot channels as placeable art.** Photoshop's spot channels are
   not directly printable as named plates from Photoshop's own print path in
   the way a shop wants; Illustrator is where they become placed art with
   colour identity.
2. **Holding spot-colour semantics.** Illustrator swatches marked as spot carry
   a name through to PostScript/PDF as a `/Separation` colourant. This is the
   part that matters most — it is what makes the RIP produce one plate per ink
   rather than one plate per process colour.
3. **Layout and scale.** Placing artwork at an exact physical size on an exact
   media size, at 100%.
4. **Registration marks.** Drawing targets that appear on every plate.
5. **Named output.** Giving each plate a name the RIP and the operator can read.
6. **Print routing.** Being the application that hands the job to AccuRIP.

## Responsibility comparison

| Responsibility | Current app | SepWiz status | Blocker | Next step |
|---|---|---|---|---|
| Import/own spot channels | Photoshop → Illustrator | **Covered.** Separations are generated natively; there is no channel handoff to make | None | — |
| Named spot-colour semantics in output | Illustrator swatches | **Covered.** Real PDF `/Separation` colour spaces with tint transforms, verified structurally in `tests/spotPdf.test.ts` | None | Validate against Emerald on the shop's machine |
| One plate per ink | Illustrator | **Covered.** One `/Separation` image per ink, overprinting, with soft masks so plates composite correctly in preview | None | — |
| Exact physical size at 100% | Illustrator artboard | **Covered.** Production size is the source of truth; artwork is placed by physical rectangle, and Film QA asserts the artboard matches to 0.01pt | None | — |
| Registration marks on every plate | Illustrator | **Covered.** Drawn in DeviceGray outside the Separation spaces, so a RIP carries them onto every plate. Pixel-verified identical across films | None | Confirm Emerald carries DeviceGray art to all plates |
| Plate naming visible to operator | Illustrator | **Covered.** Plate names are the ink names, uppercased, plus an on-page legend | None | — |
| Halftone screening | Usually deferred to the RIP | **Covered, and optional.** SepWiz can screen or emit continuous tone | None | Decide per shop whether SepWiz or Emerald screens |
| Media size / orientation | Illustrator document setup | **Partial.** The artboard is artwork + margin; there is no "place on 13×19 media" control | No media-size model | Add a media size to `ExportSettings` if Emerald does not handle it |
| Trapping / choke between spots | Illustrator (manual) | **Partial.** Per-ink choke and spread exist; there is no automatic trap between adjacent spots | No trap engine | Only if the shop asks — most spot work chokes the base, which is covered |
| Vector type and line art | Illustrator | **Not covered.** SepWiz is raster throughout | Raster-only architecture | Out of scope; artwork arrives as raster |
| Handing the job to the RIP | Illustrator print dialog | **Not covered.** SepWiz produces a file; a human opens it | No print path | See `rip-replacement-research.md` |

## Assessment

**For a raster separation job, Illustrator looks removable now**, provided the
spot PDF is accepted by Emerald. Everything Illustrator contributes in this
workflow — spot semantics, one plate per ink, exact scale, registration, plate
names — is present in the spot PDF and verified in the test suite at the
structural level.

Two caveats worth stating plainly:

- **This is verified against the PDF specification and an independent renderer
  (CoreGraphics), not against AccuRIP Emerald.** Structural correctness is
  necessary, not sufficient. A RIP can be particular.
- **Vector artwork still needs Illustrator.** SepWiz separates rasters. A job
  that arrives as vector line art and must stay vector is not this path.

## The validation that would settle it

Not a code change — a shop test:

1. Export a spot PDF from SepWiz for a job Nick has already run.
2. Open it in Emerald exactly as he would an Illustrator file.
3. Confirm the plate list matches the ink names.
4. Confirm each plate images separately, at 100%, with registration on all.
5. Compare the film to the one produced via the Illustrator path.

Until that has happened, the claim is "should work", not "does".
