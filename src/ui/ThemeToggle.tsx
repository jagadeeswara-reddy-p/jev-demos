import { useEffect, useState } from "react";
import { refreshCanvasTheme } from "./drawBoard";

// System follows the OS setting; Light and Dark pin it. The choice is a
// per-viewer convenience, so it lives in localStorage (and survives without it).

type ThemeChoice = "system" | "light" | "dark";

const KEY = "theme";
const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  refreshCanvasTheme();
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(stored);

  useEffect(() => {
    applyTheme(choice);
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // storage blocked: the choice still applies for this visit
    }
  }, [choice]);

  // Canvases cache colours; refresh them when the OS theme flips under "System".
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => refreshCanvasTheme();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="control">
      <span className="label" id="theme-label">
        Theme
      </span>
      <div className="segmented" role="group" aria-labelledby="theme-label">
        {CHOICES.map((c) => (
          <button key={c.value} type="button" aria-pressed={choice === c.value} onClick={() => setChoice(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
