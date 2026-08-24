export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}
export function applyTheme(doc: Document, theme: Theme): void {
  doc.documentElement.setAttribute("data-theme", theme);
}
