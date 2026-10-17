import { useEffect, useState } from "react";
import { refreshCanvasTheme } from "./drawBoard";
import { Icon } from "./Icon";

// System follows the OS setting; Light and Dark pin it. The choice is a
// per-viewer convenience, so it lives in localStorage (and survives without it).

type ThemeChoice = "system" | "light" | "dark";

const KEY = "theme";
const CHOICES: { value: ThemeChoice; label: string; icon: "system" | "sun" | "moon" }[] = [
  { value: "system", label: "System", icon: "system" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
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

  // One button that steps System → Light → Dark.
  const current = CHOICES.find((c) => c.value === choice)!;
  const nextChoice = CHOICES[(CHOICES.indexOf(current) + 1) % CHOICES.length];
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setChoice(nextChoice.value)}
      aria-label={`Theme: ${current.label}. Switch to ${nextChoice.label}`}
      title={`Theme: ${current.label}`}
    >
      <Icon name={current.icon} />
    </button>
  );
}
