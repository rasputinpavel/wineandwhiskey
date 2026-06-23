import { describe, it, expect } from "vitest";
import { detectLang } from "../src/lang.js";

describe("detectLang", () => {
  it("detects Russian from Cyrillic", () => {
    expect(detectLang("что это за вино", "en")).toBe("ru");
  });
  it("detects English from Latin", () => {
    expect(detectLang("what is this wine", "ru")).toBe("en");
  });
  it("uses fallback when text is empty", () => {
    expect(detectLang("", "ru")).toBe("ru");
    expect(detectLang("   ", "en")).toBe("en");
  });
  it("treats majority-Cyrillic mixed text as Russian", () => {
    expect(detectLang("это Chateau Margaux 2015", "en")).toBe("ru");
  });
  it("treats a wine name with no Cyrillic as English", () => {
    expect(detectLang("Chateau Margaux 2015", "ru")).toBe("en");
  });
});
