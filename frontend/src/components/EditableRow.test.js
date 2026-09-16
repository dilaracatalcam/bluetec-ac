import { describe, it, expect } from "vitest";
import { espHexToHtml, htmlToEspHex } from "./EditableRow.jsx";

describe("espHexToHtml", () => {
  it("0x öneki olan hex'i #rrggbb formatına çevirir", () => {
    expect(espHexToHtml("0x4DB748")).toBe("#4db748");
  });

  it("öneksiz hex'i de doğru çevirir", () => {
    expect(espHexToHtml("4DB748")).toBe("#4db748");
  });

  it("zaten # ile başlayan girdiyi de kabul eder", () => {
    expect(espHexToHtml("#4DB748")).toBe("#4db748");
  });

  it("kısa hex'i 6 haneye tamamlar (padStart)", () => {
    expect(espHexToHtml("0xFF")).toBe("#0000ff");
  });

  it("boş/null/undefined girdi için siyah varsayılanı döner", () => {
    expect(espHexToHtml("")).toBe("#000000");
    expect(espHexToHtml(null)).toBe("#000000");
    expect(espHexToHtml(undefined)).toBe("#000000");
  });
});

describe("htmlToEspHex", () => {
  it("#rrggbb formatını 0xRRGGBB formatına çevirir", () => {
    expect(htmlToEspHex("#4db748")).toBe("0x4DB748");
  });

  it("# önekini kaldırıp büyük harfe çevirir", () => {
    expect(htmlToEspHex("4db748")).toBe("0x4DB748");
  });
});

describe("espHexToHtml / htmlToEspHex round-trip", () => {
  it("ileri geri çevrildiğinde aynı renge döner", () => {
    const original = "0x4DB748";
    expect(htmlToEspHex(espHexToHtml(original))).toBe(original);
  });
});
