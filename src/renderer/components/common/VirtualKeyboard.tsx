import { useState } from "react";
import styled, { type DefaultTheme } from "styled-components";
import { Delete, Globe, X } from "lucide-react";

/* ── layout definitions ─────────────────────────────────── */

type KeyDef =
  | string
  | { key: string; label?: string; width?: number; active?: boolean };

const QWERTY_NORMAL: KeyDef[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  [
    { key: "SHIFT", label: "⇧", width: 2 },
    "z",
    "x",
    "c",
    "v",
    "b",
    "n",
    "m",
    { key: "BACKSPACE", width: 2 },
  ],
  [
    { key: "GLOBE", width: 1 },
    { key: "SPACE", label: " ", width: 5 },
    { key: "ENTER", label: "⏎", width: 2 },
  ],
];

const QWERTY_SHIFT: KeyDef[][] = [
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  [
    { key: "SHIFT", label: "⇧", width: 2, active: true },
    "Z",
    "X",
    "C",
    "V",
    "B",
    "N",
    "M",
    { key: "BACKSPACE", width: 2 },
  ],
  [
    { key: "GLOBE", width: 1 },
    { key: "SPACE", label: " ", width: 5 },
  ],
];

const CYRILLIC_NORMAL: KeyDef[][] = [
  ["й", "ц", "у", "к", "е", "н", "г", "ш", "щ", "з", "х", "ъ"],
  ["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "э"],
  [
    { key: "SHIFT", label: "⇧", width: 2 },
    "я",
    "ч",
    "с",
    "м",
    "и",
    "т",
    "ь",
    "б",
    "ю",
    { key: "BACKSPACE", width: 2 },
  ],
  [
    { key: "GLOBE", width: 1 },
    { key: "SPACE", label: " ", width: 5 },
    { key: "ENTER", label: "⏎", width: 2 },
  ],
];

const CYRILLIC_SHIFT: KeyDef[][] = [
  ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х", "Ъ"],
  ["Ф", "Ы", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Э"],
  [
    { key: "SHIFT", label: "⇧", width: 2, active: true },
    "Я",
    "Ч",
    "С",
    "М",
    "И",
    "Т",
    "Ь",
    "Б",
    "Ю",
    { key: "BACKSPACE", width: 2 },
  ],
  [
    { key: "GLOBE", width: 1 },
    { key: "SPACE", label: " ", width: 5 },
  ],
];

/* ── types ──────────────────────────────────────────────── */

interface VirtualKeyboardProps {
  numbersOnly?: boolean;
  fixed?: boolean;
  zIndex?: number;
  onKeyPress: (key: string) => void;
  onClose: () => void;
}

/* ── helpers ────────────────────────────────────────────── */

function getKey(def: KeyDef) {
  return typeof def === "string" ? def : def.key;
}
function getLabel(def: KeyDef, shifted: boolean) {
  if (typeof def !== "string") return def.label ?? def.key;
  if (shifted && /^[a-z]$/.test(def)) return def.toUpperCase();
  return def;
}
function getWidth(def: KeyDef) {
  return typeof def !== "string" && def.width ? def.width : 1;
}
function isActive(def: KeyDef) {
  return typeof def !== "string" && def.active;
}

/**
 * Semantic accent per command key, so a cashier can pick out "delete" from "confirm"
 * without reading the glyph. Theme tokens rather than literals — these have to survive
 * the dark theme, where a hardcoded red goes muddy against #1e1e1e.
 */
const KEY_ACCENTS: Record<string, keyof DefaultTheme["colors"]> = {
  BACKSPACE: "error", // destructive
  ENTER: "success", // confirms / submits
  SHIFT: "primary", // mode toggle, matches its engaged highlight
  GLOBE: "info", // language switch
  SPACE: "textSecondary", // neutral: the label is blank, so the tint is the only cue
};

/** The command keys are exactly the accented ones — one list, so they can't drift. */
const SPECIAL_KEYS = new Set(Object.keys(KEY_ACCENTS));

function isLetterKey(key: string) {
  if (SPECIAL_KEYS.has(key)) return false;
  return /^[a-zA-Zа-яА-ЯёЁ]$/.test(key);
}

function isSymbolKey(key: string) {
  if (SPECIAL_KEYS.has(key)) return false;
  if (/^[0-9]+$/.test(key)) return false; // digits, incl. the "00" quick key — never a symbol
  if (/^[a-zA-Zа-яА-ЯёЁ]$/.test(key)) return false;
  return true;
}

/* ── styled ─────────────────────────────────────────────── */

const Overlay = styled.div<{ $fixed?: boolean; $zIndex?: number }>`
  position: ${({ $fixed }) => ($fixed ? "fixed" : "absolute")};
  bottom: 0;
  left: 0;
  right: 0;
  z-index: ${({ $zIndex }) => $zIndex ?? 200};
  animation: slideUp 0.2s ease;

  @keyframes slideUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
`;

/**
 * The panel needs its own ground. Without one the blur is the only thing separating the
 * keys from the page behind them, and in the light theme a white key on a blurred white
 * page is invisible. Deliberately the *darker* of the two surface tokens so the keys —
 * which sit on `surface` — read as raised.
 */
const Wrapper = styled.div`
  width: 100%;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background}f2;
  backdrop-filter: blur(10px);
  padding: 8px 12px 14px;
  user-select: none;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
`;

const Header = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 2px;
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: 4px;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
    background: ${({ theme }) => theme.colors.border}40;
  }
`;

const Row = styled.div`
  display: flex;
  justify-content: center;
  gap: 5px;
  margin-bottom: 5px;

  &:last-child {
    margin-bottom: 0;
  }
`;

/** Accent for one key, or the primary fallback for plain letter/digit keys. */
function accentOf(theme: DefaultTheme, accent?: keyof DefaultTheme["colors"]) {
  return accent ? theme.colors[accent] : theme.colors.primary;
}

/**
 * Opaque blend of `color` into the key face. Alpha suffixes (`+ "14"`) were letting the
 * blurred page show through, which is what made these keys muddy in the light theme.
 */
function face(theme: DefaultTheme, color: string, pct: number) {
  return `color-mix(in srgb, ${color} ${pct}%, ${theme.colors.surface})`;
}

/**
 * Pulls an accent toward the theme's text colour: darker on the light theme, lighter on
 * the dark one. Both themes' accents are mid-tone greens/blues that are readable on their
 * own background but not on the other's, and this rebalances without a second palette.
 */
function labelColor(theme: DefaultTheme, accent: keyof DefaultTheme["colors"]) {
  return `color-mix(in srgb, ${theme.colors[accent]} 70%, ${theme.colors.text})`;
}

const Key = styled.button<{
  $w: number;
  $active?: boolean;
  $accent?: keyof DefaultTheme["colors"];
  $disabled?: boolean;
}>`
  flex: ${({ $w }) => $w};
  height: 56px;
  padding: 0;
  border-radius: 8px;
  /* A disabled key must not advertise itself, so the accent drops out entirely first. */
  border: 1px solid
    ${({ theme, $accent, $disabled }) =>
      $disabled || !$accent
        ? theme.colors.border
        : face(theme, theme.colors[$accent], 45)};
  background: ${({ theme, $active, $accent, $disabled }) =>
    $disabled
      ? face(theme, theme.colors.border, 55)
      : $active
        ? face(theme, accentOf(theme, $accent), 26)
        : $accent
          ? face(theme, theme.colors[$accent], 12)
          : theme.colors.surface};
  color: ${({ theme, $accent, $disabled }) =>
    $disabled
      ? theme.colors.textSecondary + "60"
      : $accent
        ? labelColor(theme, $accent)
        : theme.colors.text};
  font-size: 20px;
  font-weight: ${({ $accent }) => ($accent ? 600 : 500)};
  cursor: ${({ $disabled }) => ($disabled ? "default" : "pointer")};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;

  &:hover {
    background: ${({ theme, $accent, $disabled }) =>
      $disabled
        ? face(theme, theme.colors.border, 55)
        : face(theme, accentOf(theme, $accent), 18)};
    border-color: ${({ theme, $accent, $disabled }) =>
      $disabled ? theme.colors.border : accentOf(theme, $accent)};
  }

  &:active {
    transform: ${({ $disabled }) => ($disabled ? "none" : "scale(0.96)")};
    background: ${({ theme, $accent, $disabled }) =>
      $disabled
        ? face(theme, theme.colors.border, 55)
        : face(theme, accentOf(theme, $accent), 26)};
  }
`;

/* ── component ──────────────────────────────────────────── */

export function VirtualKeyboard({
  numbersOnly = false,
  fixed = false,
  zIndex,
  onKeyPress,
  onClose,
}: VirtualKeyboardProps) {
  const [shifted, setShifted] = useState(false);
  const [cyrillic, setCyrillic] = useState(false);

  const layout = cyrillic
    ? shifted
      ? CYRILLIC_SHIFT
      : CYRILLIC_NORMAL
    : shifted
      ? QWERTY_SHIFT
      : QWERTY_NORMAL;

  const handleClick = (key: string, disabled: boolean) => {
    if (disabled) return;

    if (key === "SHIFT") {
      setShifted((s) => !s);
      return;
    }

    if (key === "GLOBE") {
      setCyrillic((c) => !c);
      setShifted(false);
      return;
    }

    if (key === "SPACE") {
      onKeyPress(" ");
    } else {
      onKeyPress(key);
    }

    if (shifted && key !== "BACKSPACE" && key !== "ENTER") {
      setShifted(false);
    }
  };

  return (
    <Overlay $fixed={fixed} $zIndex={zIndex}>
      <Wrapper onMouseDown={(e) => e.preventDefault()}>
        <Header>
          <CloseBtn type="button" tabIndex={-1} onClick={onClose}>
            <X size={18} />
          </CloseBtn>
        </Header>
        {layout.map((row, ri) => (
          <Row key={ri}>
            {row.map((def) => {
              const key = getKey(def);
              const label = getLabel(def, shifted);
              const width = getWidth(def);
              const active = isActive(def);
              const disabled =
                numbersOnly &&
                (isLetterKey(key) ||
                  isSymbolKey(key) ||
                  key === "SHIFT" ||
                  key === "SPACE" ||
                  key === "GLOBE");

              return (
                <Key
                  key={key}
                  $w={width}
                  $active={active || (key === "GLOBE" && cyrillic)}
                  $accent={KEY_ACCENTS[key]}
                  $disabled={disabled}
                  type="button"
                  tabIndex={-1}
                  onClick={() => handleClick(key, disabled)}
                >
                  {/* Icons inherit the key's accent through currentColor. */}
                  {key === "BACKSPACE" ? (
                    <Delete size={24} />
                  ) : key === "GLOBE" ? (
                    <Globe size={18} />
                  ) : (
                    label
                  )}
                </Key>
              );
            })}
          </Row>
        ))}
      </Wrapper>
    </Overlay>
  );
}
