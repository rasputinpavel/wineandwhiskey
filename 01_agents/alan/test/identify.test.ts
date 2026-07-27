import { describe, it, expect } from "vitest";
import { identityHint, identityLabel } from "../src/identify.js";
import type { Identity } from "../src/identify.js";

const base: Identity = {
  producer: "Château Haut-Vigneau",
  name: "",
  vintage: "2020",
  region: "Pessac-Léognan",
  grape: "Sauvignon Blanc",
  type: "white",
  idConfidence: "high",
};

describe("identityHint", () => {
  it("appends the photo-read color so research locks to THIS bottle's color", () => {
    expect(identityHint(base)).toBe("Château Haut-Vigneau 2020 (white)");
  });
  it("omits the parenthetical when the color is unknown", () => {
    expect(identityHint({ ...base, type: "" })).toBe("Château Haut-Vigneau 2020");
  });
  it("keeps identityLabel color-free (used for echo and cache key)", () => {
    expect(identityLabel(base)).toBe("Château Haut-Vigneau 2020");
  });
});
