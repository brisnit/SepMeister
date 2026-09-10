import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A minimal localStorage stand-in.
 *
 * The store modules are written to survive storage being absent, full, or
 * holding data from an older build, and those are exactly the conditions a
 * real browser produces — so they are tested directly rather than assumed.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  throwOnWrite = false;
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.throwOnWrite) throw new DOMException("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal("localStorage", store);
  vi.resetModules();
});

describe("storage helpers", () => {
  it("round-trips JSON", async () => {
    const { readJson, writeJson } = await import("@/lib/store/storage");
    expect(writeJson("k", { a: 1 })).toBe(true);
    expect(readJson("k", null)).toEqual({ a: 1 });
  });

  it("namespaces its keys", async () => {
    const { writeJson } = await import("@/lib/store/storage");
    writeJson("presets", [1]);
    expect(store.key(0)).toMatch(/^sepai\.v1\./);
  });

  it("falls back when the value is missing or corrupt", async () => {
    const { readJson } = await import("@/lib/store/storage");
    expect(readJson("missing", "fallback")).toBe("fallback");
    store.setItem("sepai.v1.broken", "{not json");
    expect(readJson("broken", "fallback")).toBe("fallback");
  });

  it("reports a failed write instead of throwing", async () => {
    const { writeJson } = await import("@/lib/store/storage");
    store.throwOnWrite = true;
    expect(writeJson("k", { a: 1 })).toBe(false);
  });

  it("detects unavailable storage without throwing", async () => {
    const { isStorageAvailable } = await import("@/lib/store/storage");
    expect(isStorageAvailable()).toBe(true);
    store.throwOnWrite = true;
    expect(isStorageAvailable()).toBe(false);
  });

  it("makes unique ids", async () => {
    const { makeId } = await import("@/lib/store/storage");
    const ids = new Set(Array.from({ length: 200 }, () => makeId("job")));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^job_/);
  });
});

describe("press presets", () => {
  it("ships example presets and labels them as examples", async () => {
    const { BUILT_IN_PRESETS, loadPresets } = await import("@/lib/store/presets");
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of BUILT_IN_PRESETS) expect(p.builtIn).toBe(true);
    expect(loadPresets()).toHaveLength(BUILT_IN_PRESETS.length);
  });

  it("matches the shapes described in the brief", async () => {
    const { BUILT_IN_PRESETS } = await import("@/lib/store/presets");
    const manual = BUILT_IN_PRESETS.find((p) => p.name.includes("Manual 6"))!;
    expect(manual.maxScreens).toBe(6);
    expect(manual.underbaseMesh).toBe(110);
    expect(manual.defaultMesh).toBe(156);
    expect(manual.highlightMesh).toBe(230);
    expect(manual.defaultLpi).toBe(45);
    expect(manual.underbaseChoke).toBe(1);
    expect(manual.useGarmentAsBlack).toBe(true);

    const auto = BUILT_IN_PRESETS.find((p) => p.name.includes("8-Color"))!;
    expect(auto.maxScreens).toBe(8);
    expect(auto.defaultMesh).toBe(230);
    expect(auto.defaultLpi).toBe(55);
  });

  it("persists custom presets and reloads them after the built-ins", async () => {
    const { loadPresets, savePresets, BUILT_IN_PRESETS } = await import("@/lib/store/presets");
    const custom = { ...BUILT_IN_PRESETS[0], id: "mine", name: "My Press", builtIn: false };
    expect(savePresets([...BUILT_IN_PRESETS, custom])).toBe(true);

    vi.resetModules();
    const again = await import("@/lib/store/presets");
    const loaded = again.loadPresets();
    expect(loaded).toHaveLength(BUILT_IN_PRESETS.length + 1);
    expect(loaded[loaded.length - 1].name).toBe("My Press");
    // Built-ins are never written to storage, so they cannot be duplicated.
    expect(loaded.filter((p) => p.builtIn)).toHaveLength(BUILT_IN_PRESETS.length);
  });

  it("captures the current job as a preset", async () => {
    const { presetFromCurrent } = await import("@/lib/store/presets");
    const preset = presetFromCurrent(
      "Shop A",
      { jobName: "j", garmentColor: "#222222", maxScreens: 8, method: "ai", meshCount: "auto", inkType: "waterbased", useGarmentAsBlack: false },
      { enabled: true, lpi: 55, shape: "ellipse" },
      { defaultMesh: 200, underbaseMesh: 156, highlightMesh: 305, detailMesh: 305 },
      1.5,
    );
    expect(preset.name).toBe("Shop A");
    expect(preset.builtIn).toBe(false);
    expect(preset.garmentColor).toBe("#222222");
    expect(preset.maxScreens).toBe(8);
    expect(preset.inkType).toBe("waterbased");
    expect(preset.defaultLpi).toBe(55);
    expect(preset.defaultDotShape).toBe("ellipse");
    expect(preset.underbaseChoke).toBe(1.5);
  });

  it("duplicates with a new id and a distinct name", async () => {
    const { duplicatePreset, BUILT_IN_PRESETS } = await import("@/lib/store/presets");
    const copy = duplicatePreset(BUILT_IN_PRESETS[0]);
    expect(copy.id).not.toBe(BUILT_IN_PRESETS[0].id);
    expect(copy.name).toContain("copy");
    expect(copy.builtIn).toBe(false);
  });

  it("maps ink roles to the preset's mesh rack", async () => {
    const { meshForRole, BUILT_IN_PRESETS } = await import("@/lib/store/presets");
    const p = BUILT_IN_PRESETS[0];
    expect(meshForRole(p, "underbase")).toBe(p.underbaseMesh);
    expect(meshForRole(p, "highlight")).toBe(p.highlightMesh);
    expect(meshForRole(p, "black")).toBe(p.detailMesh);
    expect(meshForRole(p, "spot")).toBe(p.defaultMesh);
  });

  it("applies to settings without clobbering unrelated fields", async () => {
    const { applyPresetToSettings, BUILT_IN_PRESETS } = await import("@/lib/store/presets");
    const current = { jobName: "keep me", garmentColor: "#ffffff", maxScreens: 4, method: "spot" as const, meshCount: 305 as const, inkType: "unknown" as const, useGarmentAsBlack: false };
    const next = applyPresetToSettings(BUILT_IN_PRESETS[0], current);
    expect(next.jobName).toBe("keep me");
    expect(next.method).toBe("spot");
    expect(next.garmentColor).toBe(BUILT_IN_PRESETS[0].garmentColor);
    expect(next.maxScreens).toBe(BUILT_IN_PRESETS[0].maxScreens);
  });

  it("survives a preset saved by an older build", async () => {
    store.setItem("sepai.v1.presets", JSON.stringify([{ id: "old", name: "Legacy" }]));
    const { loadPresets } = await import("@/lib/store/presets");
    const loaded = loadPresets();
    const legacy = loaded.find((p) => p.id === "old")!;
    expect(legacy).toBeDefined();
    expect(typeof legacy.defaultMesh).toBe("number");
    expect(typeof legacy.defaultLpi).toBe("number");
  });

  it("ignores garbage in the presets key", async () => {
    store.setItem("sepai.v1.presets", JSON.stringify({ not: "an array" }));
    const { loadPresets, BUILT_IN_PRESETS } = await import("@/lib/store/presets");
    expect(loadPresets()).toHaveLength(BUILT_IN_PRESETS.length);
  });
});

describe("session persistence", () => {
  const session = () => ({
    version: 1 as const,
    savedAt: "2024-01-01T00:00:00.000Z",
    metadata: { id: "job_1", jobName: "Sailor Tee", customer: "Nick", notes: "n", createdAt: "2024-01-01T00:00:00.000Z" },
    settings: { jobName: "j", garmentColor: "#111111", maxScreens: 6, method: "ai" as const, meshCount: "auto" as const, inkType: "plastisol" as const, useGarmentAsBlack: true },
    productionSize: { widthIn: 12, heightIn: 15, units: "in" as const, lockAspect: true },
    halftone: { enabled: true, lpi: 45, shape: "round" as const },
    exportSettings: { filmDpi: 600, includeRegistration: true, includeCropMarks: true, includeCenterMarks: true, marginIn: 0.75 },
    underbase: { choke: 2, strength: 0.9, removeUnderBlack: false, highlightWhite: true },
    removeBackground: false,
    inks: [
      { id: "ink-0", name: "Cream", displayColor: "#eadfc1", type: "spot", order: 1, visible: true, mesh: 230, settings: { threshold: 10, gain: 1.1, choke: 0.5, spread: 0 }, halftone: { enabled: true, lpi: 55, angle: 37.5, shape: "ellipse" as const } },
      { id: "underbase", name: "White Underbase", displayColor: "#ffffff", type: "underbase", order: 0, visible: true, mesh: 110, settings: { threshold: 0, gain: 1, choke: 2, spread: 0 }, halftone: { enabled: false, lpi: 45, angle: 22.5, shape: "round" as const } },
    ],
    printOrder: ["underbase", "ink-0"],
    artworkFileName: "badge.png",
    artworkPixelWidth: 1000,
    artworkPixelHeight: 1000,
    presetId: "builtin-manual-6",
  });

  it("round-trips a full session", async () => {
    const { saveSession, loadSession } = await import("@/lib/store/session");
    expect(saveSession(session())).toBe(true);
    const loaded = loadSession()!;
    expect(loaded.metadata.jobName).toBe("Sailor Tee");
    expect(loaded.metadata.customer).toBe("Nick");
    expect(loaded.productionSize.widthIn).toBe(12);
    expect(loaded.halftone.lpi).toBe(45);
    expect(loaded.exportSettings.filmDpi).toBe(600);
    expect(loaded.underbase.choke).toBe(2);
    expect(loaded.underbase.highlightWhite).toBe(true);
    expect(loaded.removeBackground).toBe(false);
    expect(loaded.inks).toHaveLength(2);
    expect(loaded.printOrder).toEqual(["underbase", "ink-0"]);
    expect(loaded.presetId).toBe("builtin-manual-6");
  });

  it("remembers the artwork name so the user can be told to re-drop it", async () => {
    const { saveSession, loadSession } = await import("@/lib/store/session");
    saveSession(session());
    expect(loadSession()!.artworkFileName).toBe("badge.png");
  });

  it("rejects a session from a future version", async () => {
    const { loadSession } = await import("@/lib/store/session");
    store.setItem("sepai.v1.session", JSON.stringify({ ...session(), version: 99 }));
    expect(loadSession()).toBeNull();
  });

  it("rejects a partially-written session", async () => {
    const { loadSession } = await import("@/lib/store/session");
    store.setItem("sepai.v1.session", JSON.stringify({ version: 1, savedAt: "x" }));
    expect(loadSession()).toBeNull();
  });

  it("clears cleanly", async () => {
    const { saveSession, loadSession, clearSession } = await import("@/lib/store/session");
    saveSession(session());
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("re-applies per-ink state onto a fresh separation by id", async () => {
    const { reapplyInkState } = await import("@/lib/store/session");
    const fresh = [
      { id: "underbase", name: "White Underbase", displayColor: "#ffffff", type: "underbase" as const, order: 0, visible: true, coverage: 0.5, meanDensity: 0.9, mesh: 110, settings: { threshold: 0, gain: 1, choke: 1, spread: 0 }, halftone: { enabled: false, lpi: 45, angle: 22.5, shape: "round" as const }, mask: new Uint8ClampedArray(4) },
      { id: "ink-0", name: "Cream", displayColor: "#eadfc1", type: "spot" as const, order: 1, visible: true, coverage: 0.3, meanDensity: 0.9, mesh: 156, settings: { threshold: 0, gain: 1, choke: 0, spread: 0 }, halftone: { enabled: true, lpi: 45, angle: 52.5, shape: "round" as const }, mask: new Uint8ClampedArray(4) },
    ];
    const { inks, matched } = reapplyInkState(fresh, session().inks);
    expect(matched).toBe(2);
    const cream = inks.find((i) => i.id === "ink-0")!;
    expect(cream.mesh).toBe(230);
    expect(cream.halftone.lpi).toBe(55);
    expect(cream.halftone.angle).toBe(37.5);
    expect(cream.settings.threshold).toBe(10);
    // The mask itself is never restored; it is regenerated by the engine.
    expect(cream.mask).toBe(fresh[1].mask);
  });

  it("leaves unmatched inks on the engine's values", async () => {
    const { reapplyInkState } = await import("@/lib/store/session");
    const fresh = [
      { id: "ink-9", name: "Navy", displayColor: "#1a2a58", type: "spot" as const, order: 0, visible: true, coverage: 0.2, meanDensity: 0.9, mesh: 156, settings: { threshold: 0, gain: 1, choke: 0, spread: 0 }, halftone: { enabled: false, lpi: 45, angle: 22.5, shape: "round" as const }, mask: new Uint8ClampedArray(4) },
    ];
    const { inks, matched } = reapplyInkState(fresh, session().inks);
    expect(matched).toBe(0);
    expect(inks[0].mesh).toBe(156);
    expect(inks[0].name).toBe("Navy");
  });
});

describe("account and entitlements", () => {
  it("starts on the free tier with nothing counted", async () => {
    const { loadAccount } = await import("@/lib/store/account");
    const a = loadAccount();
    expect(a.entitlements.tier).toBe("FREE");
    expect(a.entitlements.separationCredits).toBe(1);
    expect(a.separationsCompleted).toBe(0);
  });

  it("counts separations and persists the count", async () => {
    const { loadAccount, recordSeparation, saveAccount } = await import("@/lib/store/account");
    let a = loadAccount();
    a = recordSeparation(recordSeparation(a));
    saveAccount(a);
    vi.resetModules();
    const again = await import("@/lib/store/account");
    expect(again.loadAccount().separationsCompleted).toBe(2);
  });

  it("never blocks a separation while enforcement is off", async () => {
    const { loadAccount, recordSeparation, canSeparate, ENFORCE_ENTITLEMENTS } = await import("@/lib/store/account");
    expect(ENFORCE_ENTITLEMENTS).toBe(false);
    let a = loadAccount();
    for (let i = 0; i < 20; i++) a = recordSeparation(a);
    expect(canSeparate(a)).toBe(true);
  });

  it("computes remaining credits for a metered tier", async () => {
    const { loadAccount, setTier, recordSeparation, remainingCredits } = await import("@/lib/store/account");
    let a = setTier(loadAccount(), "CREATOR");
    expect(remainingCredits(a)).toBe(20);
    for (let i = 0; i < 5; i++) a = recordSeparation(a);
    expect(remainingCredits(a)).toBe(15);
  });

  it("reports unmetered tiers as unlimited", async () => {
    const { loadAccount, setTier, remainingCredits } = await import("@/lib/store/account");
    expect(remainingCredits(setTier(loadAccount(), "PRO"))).toBeNull();
  });

  it("defines every tier", async () => {
    const { TIER_ENTITLEMENTS } = await import("@/lib/store/account");
    for (const tier of ["FREE", "PAY_PER_JOB", "CREATOR", "SHOP", "PRO"] as const) {
      expect(TIER_ENTITLEMENTS[tier].tier).toBe(tier);
    }
  });

  it("recovers from a corrupt account record", async () => {
    store.setItem("sepai.v1.account", JSON.stringify({ entitlements: { tier: "NOPE" }, separationsCompleted: "many" }));
    const { loadAccount } = await import("@/lib/store/account");
    const a = loadAccount();
    expect(a.entitlements.tier).toBe("FREE");
    expect(a.separationsCompleted).toBe(0);
  });
});

describe("test print feedback", () => {
  const record = (jobId: string, outcome: "excellent" | "failed" = "good" as never) => ({
    id: `fb_${jobId}`,
    jobId,
    jobName: "Sailor Tee",
    recordedAt: "2024-01-02T00:00:00.000Z",
    outcome,
    filmsRegistered: true,
    underbasePrinted: true,
    detailHeld: false,
    colorsClose: true,
    changedAnything: true,
    whatChanged: "Opened the choke to 2px",
    notes: "230 mesh held better",
    snapshot: {
      screens: 6, garmentColor: "#111111", widthIn: 12, heightIn: 15,
      effectiveDpi: 300, sepScore: 85, similarity: 95,
      inks: [{ name: "Cream", mesh: 230, lpi: 45, angle: 22.5, shape: "round" }],
    },
  });

  it("persists and reloads records", async () => {
    const { saveFeedback, loadFeedback } = await import("@/lib/store/feedback");
    expect(saveFeedback([record("job_1", "excellent")])).toBe(true);
    vi.resetModules();
    const again = await import("@/lib/store/feedback");
    const loaded = again.loadFeedback();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].whatChanged).toBe("Opened the choke to 2px");
    expect(loaded[0].snapshot.inks[0].lpi).toBe(45);
  });

  it("replaces an earlier answer for the same job", async () => {
    const { addFeedback } = await import("@/lib/store/feedback");
    const first = addFeedback([], record("job_1", "excellent"));
    const second = addFeedback(first, { ...record("job_1", "failed"), id: "fb_new" });
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe("fb_new");
    expect(second[0].outcome).toBe("failed");
  });

  it("keeps records for different jobs", async () => {
    const { addFeedback, feedbackForJob } = await import("@/lib/store/feedback");
    const list = addFeedback(addFeedback([], record("job_1")), record("job_2"));
    expect(list).toHaveLength(2);
    expect(feedbackForJob(list, "job_2")!.jobId).toBe("job_2");
    expect(feedbackForJob(list, "nope")).toBeNull();
  });

  it("exports valid JSON carrying the settings that produced the print", async () => {
    const { feedbackExportJson } = await import("@/lib/store/feedback");
    const parsed = JSON.parse(feedbackExportJson([record("job_1")]));
    expect(parsed.count).toBe(1);
    expect(parsed.records[0].jobName).toBe("Sailor Tee");
    expect(parsed.records[0].snapshot.sepScore).toBe(85);
    expect(parsed.records[0].changedAnything).toBe(true);
    expect(typeof parsed.exportedAt).toBe("string");
  });

  it("ignores garbage in the feedback key", async () => {
    store.setItem("sepai.v1.feedback", JSON.stringify([{ nope: true }, null]));
    const { loadFeedback } = await import("@/lib/store/feedback");
    expect(loadFeedback()).toHaveLength(0);
  });
});
