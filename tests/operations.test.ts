import { describe, it, expect } from "vitest";
import { parseCommand, deterministicProvider, requiresReseparation, SUGGESTED_COMMANDS, type CommandContext } from "@/lib/ai/operations";
import { nameForColor, disambiguateNames, slugify } from "@/lib/engine/naming";

const CTX: CommandContext = {
  inks: [
    { id: "underbase", name: "White Underbase", type: "underbase" },
    { id: "ink-0", name: "Cream", type: "spot" },
    { id: "ink-1", name: "Light Blue", type: "spot" },
    { id: "ink-2", name: "Navy", type: "spot" },
    { id: "ink-3", name: "Red", type: "spot" },
  ],
  currentScreenCount: 5,
  maxScreens: 6,
  garmentColor: "#111111",
  underbaseChoke: 1,
  meshCounts: [110, 156, 156, 156, 156],
};

describe("command parsing", () => {
  it("handles every suggested command", async () => {
    for (const cmd of SUGGESTED_COMMANDS) {
      const r = await deterministicProvider.interpret(cmd, CTX);
      expect(r.understood, `"${cmd}" should be understood`).toBe(true);
      expect(r.operations.length).toBeGreaterThan(0);
      expect(r.explanation.length).toBeGreaterThan(10);
    }
  });

  it("reduces screen count", () => {
    const r = parseCommand("Reduce this to 5 screens", CTX);
    expect(r.understood).toBe(true);
    expect(r.operations).toEqual([{ action: "reduce_screen_count", target: 5 }]);
    expect(r.requiresReseparation).toBe(true);
  });

  it("understands spelled-out numbers", () => {
    expect(parseCommand("cut this down to four screens", CTX).operations)
      .toEqual([{ action: "reduce_screen_count", target: 4 }]);
  });

  it("asks for a number when one is missing", () => {
    const r = parseCommand("reduce the screens", CTX);
    expect(r.understood).toBe(false);
    expect(r.explanation).toMatch(/how many/i);
  });

  it("rejects out-of-range screen counts", () => {
    expect(parseCommand("reduce this to 40 screens", CTX).understood).toBe(false);
  });

  it("toggles garment-as-black in both directions", () => {
    expect(parseCommand("Use the garment for black", CTX).operations)
      .toEqual([{ action: "use_garment_as_black", enabled: true }]);
    expect(parseCommand("don't use the garment for black", CTX).operations)
      .toEqual([{ action: "use_garment_as_black", enabled: false }]);
  });

  it("sets garment color by name and hex", () => {
    expect(parseCommand("change the garment to navy", CTX).operations)
      .toEqual([{ action: "set_garment_color", color: "#1b2a4a" }]);
    expect(parseCommand("set the shirt to #445566", CTX).operations)
      .toEqual([{ action: "set_garment_color", color: "#445566" }]);
  });

  it("adjusts the underbase", () => {
    expect(parseCommand("set underbase choke to 2px", CTX).operations)
      .toEqual([{ action: "set_underbase_choke", pixels: 2 }]);

    const more = parseCommand("Increase underbase coverage", CTX);
    expect(more.understood).toBe(true);
    expect(more.operations).toContainEqual({ action: "set_underbase_choke", pixels: 0 });

    const less = parseCommand("Reduce underbase", CTX);
    expect(less.operations).toEqual([{ action: "set_underbase_strength", strength: 0.75 }]);
  });

  it("clamps choke to the supported range", () => {
    expect(parseCommand("set underbase choke to 40px", CTX).operations)
      .toEqual([{ action: "set_underbase_choke", pixels: 4 }]);
  });

  it("removes a named separation", () => {
    const r = parseCommand("Remove the cream screen", CTX);
    expect(r.operations).toEqual([{ action: "remove_ink", inkId: "ink-0" }]);
    expect(r.requiresReseparation).toBe(false);
  });

  it("prefers the longest matching ink name", () => {
    // "light blue" must not be matched by the shorter, distinct "Navy".
    const r = parseCommand("remove the light blue screen", CTX);
    expect(r.operations).toEqual([{ action: "remove_ink", inkId: "ink-1" }]);
  });

  it("merges one ink into another", () => {
    const r = parseCommand("merge light blue into navy", CTX);
    expect(r.operations).toEqual([{ action: "merge_ink", sourceInkId: "ink-1", targetInkId: "ink-2" }]);
  });

  it("adjusts per-ink strength", () => {
    expect(parseCommand("make the red stronger", CTX).operations)
      .toEqual([{ action: "set_ink_gain", inkId: "ink-3", gain: 1.25 }]);
    expect(parseCommand("make the navy lighter", CTX).operations)
      .toEqual([{ action: "set_ink_gain", inkId: "ink-2", gain: 0.8 }]);
  });

  it("targets a mesh count", () => {
    expect(parseCommand("Make this safer for 156 mesh", CTX).operations)
      .toEqual([{ action: "set_mesh_safety_target", mesh: 156 }]);
  });

  it("configures halftones", () => {
    const on = parseCommand("add halftones at 55 LPI", CTX);
    expect(on.operations).toEqual([{ action: "set_halftone", enabled: true, lpi: 55, shape: "round" }]);

    expect(parseCommand("use elliptical dots at 45 lpi", CTX).operations)
      .toEqual([{ action: "set_halftone", enabled: true, lpi: 45, shape: "ellipse" }]);

    expect(parseCommand("remove halftones", CTX).operations)
      .toEqual([{ action: "set_halftone", enabled: false }]);
  });

  it("declines to invent detail, and explains why", () => {
    const r = parseCommand("Add more detail to the face", CTX);
    expect(r.understood).toBe(false);
    expect(r.explanation).toMatch(/cannot add or invent detail/i);
    expect(r.operations).toHaveLength(0);
  });

  it("refuses to guess at unrecognised commands", () => {
    const r = parseCommand("make it pop more", CTX);
    expect(r.understood).toBe(false);
    expect(r.operations).toHaveLength(0);
    expect(r.explanation).toMatch(/isn't recognised/i);
  });

  it("handles empty input", () => {
    expect(parseCommand("   ", CTX).understood).toBe(false);
  });

  it("is deterministic", () => {
    for (const cmd of SUGGESTED_COMMANDS) {
      expect(parseCommand(cmd, CTX)).toEqual(parseCommand(cmd, CTX));
    }
  });
});

describe("reseparation classification", () => {
  it("flags ink-identity changes as needing a full re-run", () => {
    expect(requiresReseparation([{ action: "reduce_screen_count", target: 4 }])).toBe(true);
    expect(requiresReseparation([{ action: "set_garment_color", color: "#fff" }])).toBe(true);
    expect(requiresReseparation([{ action: "set_method", method: "spot" }])).toBe(true);
  });

  it("treats mask edits as local", () => {
    expect(requiresReseparation([{ action: "set_ink_gain", inkId: "ink-0", gain: 1.2 }])).toBe(false);
    expect(requiresReseparation([{ action: "remove_ink", inkId: "ink-0" }])).toBe(false);
    expect(requiresReseparation([{ action: "set_halftone", enabled: true }])).toBe(false);
  });
});

describe("ink naming", () => {
  it("names common screen-print colors", () => {
    expect(nameForColor("#1a2a58")).toBe("Navy");
    expect(nameForColor("#ffffff")).toBe("White");
    expect(nameForColor("#111114")).toBe("Black");
    expect(nameForColor("#e8dcc0")).toBe("Cream");
    expect(nameForColor("#c8262a")).toBe("Red");
  });

  it("gives colliding colors distinct real ink names", () => {
    const names = disambiguateNames([
      { hex: "#7ab0db", name: "Light Blue" },
      { hex: "#8fc0e5", name: "Light Blue" },
    ]);
    expect(new Set(names).size).toBe(2);
    // Never stack qualifiers into "Light Light Blue".
    for (const n of names) expect(n).not.toMatch(/\b(Light|Dark|Pale|Deep)\s+(Light|Dark|Pale|Deep)\b/);
  });

  it("keeps names distinct across many similar colors", () => {
    const names = disambiguateNames(
      ["#1a2a58", "#22336a", "#2a3d7c", "#33478e", "#3c51a0"].map((hex) => ({ hex, name: nameForColor(hex) })),
    );
    expect(new Set(names).size).toBe(5);
  });

  it("slugifies for file names", () => {
    expect(slugify("White Underbase")).toBe("white-underbase");
    expect(slugify("Light Blue")).toBe("light-blue");
    expect(slugify("  ///  ")).toBe("ink");
  });
});
