import { describe, it, expect } from "vitest";
import {
  addEmeraldResult, emptyEmeraldResult, hasEmeraldAnswers, hasSetupAnswers,
  emeraldVerdict, emeraldExportCsv, emeraldExportJson, validatedWorkflowMarkdown,
} from "@/lib/store/emerald";
import { emptyAccuRipSetup } from "@/lib/types";
import type { EmeraldValidationResult } from "@/lib/types";

function draft(over: Partial<EmeraldValidationResult> = {}): EmeraldValidationResult {
  return { ...emptyEmeraldResult("Badge Tee", "sepwiz-screened", 6), ...over };
}

describe("AccuRIP setup capture", () => {
  it("starts completely empty, with nothing guessed", () => {
    // A prefilled printer model would later read as a validated one.
    const s = emptyAccuRipSetup();
    expect(Object.values(s).every((v) => v === "")).toBe(true);
    expect(hasSetupAnswers(s)).toBe(false);
  });

  it("captures every field the RIP research needs", () => {
    const keys = Object.keys(emptyAccuRipSetup()).sort();
    expect(keys).toEqual([
      "accuRipVersion", "blackInkStrategy", "customPresets", "densitySettings",
      "halftoneSettings", "inkChannelConfiguration", "mediaType",
      "outputResolution", "pageSize", "printerManufacturer", "printerModel",
    ]);
  });

  it("notices once anything has been typed", () => {
    expect(hasSetupAnswers({ ...emptyAccuRipSetup(), printerModel: "P800" })).toBe(true);
    // Whitespace is not an answer.
    expect(hasSetupAnswers({ ...emptyAccuRipSetup(), printerModel: "   " })).toBe(false);
  });
});

describe("Emerald validation results", () => {
  it("starts with every observation unanswered", () => {
    const r = emptyEmeraldResult("Badge Tee", "sepwiz-screened", 6);
    expect(r.fileOpened).toBeNull();
    expect(r.spotPlatesDetected).toBeNull();
    expect(r.plateNamesPreserved).toBeNull();
    expect(r.screeningBehavior).toBeNull();
    expect(r.filmOutput).toBeNull();
    expect(r.expectedSpotPlates).toBe(6);
    expect(hasEmeraldAnswers(r)).toBe(false);
  });

  it("keeps one record per job AND screening mode", () => {
    // Both modes go through the same RIP and can behave differently; keying on
    // the job alone would overwrite half the experiment.
    let records: EmeraldValidationResult[] = [];
    records = addEmeraldResult(records, draft({ screeningMode: "sepwiz-screened" }));
    records = addEmeraldResult(records, draft({ screeningMode: "continuous-tone" }));
    expect(records).toHaveLength(2);

    records = addEmeraldResult(records, draft({ screeningMode: "sepwiz-screened", notes: "again" }));
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.screeningMode === "sepwiz-screened")!.notes).toBe("again");
    expect(records.find((r) => r.screeningMode === "continuous-tone")!.notes).toBe("");
  });

  it("keeps records for different jobs apart", () => {
    let records: EmeraldValidationResult[] = [];
    records = addEmeraldResult(records, draft({ jobName: "A" }));
    records = addEmeraldResult(records, draft({ jobName: "B" }));
    expect(records).toHaveLength(2);
  });

  it("counts a single typed field as an answer", () => {
    expect(hasEmeraldAnswers(draft({ notes: "plate list looked right" }))).toBe(true);
    expect(hasEmeraldAnswers(draft({ fileOpened: false }))).toBe(true);
    expect(hasEmeraldAnswers(draft({ spotPlatesDetected: 0 }))).toBe(true);
    expect(hasEmeraldAnswers(draft({
      setup: { ...emptyAccuRipSetup(), accuRipVersion: "1.0.4" },
    }))).toBe(true);
  });

  it("never reports an untested job as working", () => {
    // The most important property of the verdict: silence must not read as
    // success to anyone skimming a list.
    expect(emeraldVerdict(draft())).toBe("Not yet tested.");
    expect(emeraldVerdict(draft({ notes: "some notes" }))).toBe("Not yet tested.");
  });

  it("says plainly when the file did not open", () => {
    expect(emeraldVerdict(draft({ fileOpened: false }))).toMatch(/could not open/i);
  });

  it("flags a plate count that does not match what we exported", () => {
    const matched = emeraldVerdict(draft({ fileOpened: true, spotPlatesDetected: 6 }));
    expect(matched).toContain("6 plates, as expected");

    const wrong = emeraldVerdict(draft({ fileOpened: true, spotPlatesDetected: 4 }));
    expect(wrong).toContain("4 plates, expected 6");
  });

  it("reports which side did the screening", () => {
    expect(emeraldVerdict(draft({ fileOpened: true, screeningBehavior: "rip-rescreened" })))
      .toMatch(/Emerald rescreened/);
    expect(emeraldVerdict(draft({ fileOpened: true, screeningBehavior: "sepwiz-preserved" })))
      .toMatch(/SepWiz screening preserved/);
  });

  it("exports every observation and the whole RIP setup to CSV", () => {
    const record = draft({
      fileOpened: true,
      spotPlatesDetected: 6,
      plateNamesPreserved: "yes",
      scalePreserved: true,
      registrationPreserved: true,
      screeningBehavior: "rip-rescreened",
      filmOutput: "correct",
      notes: "Rescreened at its own 55 LPI - film was good",
      setup: { ...emptyAccuRipSetup(), printerModel: "P800", accuRipVersion: "1.0.4" },
    });
    const csv = emeraldExportCsv([record]);
    const [header, row] = csv.split("\n");
    expect(header).toContain("screening_behavior");
    expect(header).toContain("black_ink_strategy");
    // Safe to split naively only because no cell in this record is quoted;
    // quoting is exercised by the next test.
    expect(row).not.toContain('"');
    expect(header.split(",")).toHaveLength(row.split(",").length);
    expect(row).toContain("rip-rescreened");
    expect(row).toContain("P800");
  });

  it("quotes CSV cells containing commas rather than corrupting the row", () => {
    const csv = emeraldExportCsv([draft({ notes: 'Plates: white, red, blue — "fine"' })]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"Plates: white, red, blue — ""fine"""');
  });

  it("exports a schema-tagged JSON record", () => {
    const parsed = JSON.parse(emeraldExportJson([draft({ fileOpened: true })]));
    expect(parsed.schema).toBe("sepwiz.emerald-result/1");
    expect(parsed.count).toBe(1);
    expect(parsed.records[0].expectedSpotPlates).toBe(6);
  });

  it("renders an empty result set as 'nothing is known', not as a blank pass", () => {
    expect(validatedWorkflowMarkdown([])).toMatch(/No Emerald validation has been recorded/i);
    expect(validatedWorkflowMarkdown([])).toMatch(/Nothing below this line is known/i);
  });

  it("renders recorded results as a table with a row per test", () => {
    const md = validatedWorkflowMarkdown([
      draft({ recordedAt: "2026-01-02T00:00:00Z", fileOpened: true, spotPlatesDetected: 6, screeningBehavior: "rip-rescreened" }),
      draft({ recordedAt: "2026-01-01T00:00:00Z", screeningMode: "continuous-tone", fileOpened: true, spotPlatesDetected: 6 }),
    ]);
    const rows = md.split("\n");
    expect(rows[0]).toContain("| Job |");
    expect(rows).toHaveLength(4);
    // Sorted oldest first, so the table reads as a log.
    expect(rows[2]).toContain("continuous-tone");
    expect(rows[3]).toContain("rip-rescreened");
    // An unanswered observation renders as a dash, never as a blank cell that
    // could be mistaken for a negative.
    expect(rows[2]).toContain("| — |");
  });
});
