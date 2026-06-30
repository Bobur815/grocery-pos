import { useState } from "react";
import styled from "styled-components";
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

const SPECIAL_KEYS = new Set(["SHIFT", "BACKSPACE", "SPACE", "ENTER", "GLOBE"]);

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

const Wrapper = styled.div`
  width: 100%;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
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

const Key = styled.button<{
  $w: number;
  $active?: boolean;
  $special?: boolean;
  $disabled?: boolean;
}>`
  flex: ${({ $w }) => $w};
  height: 56px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme, $special, $active, $disabled }) =>
    $disabled
      ? theme.colors.border + "30"
      : $active
        ? theme.colors.primary + "30"
        : $special
          ? theme.colors.background
          : theme.colors.surface};
  color: ${({ theme, $disabled }) =>
    $disabled ? theme.colors.textSecondary + "60" : theme.colors.text};
  font-size: 20px;
  font-weight: 500;
  cursor: ${({ $disabled }) => ($disabled ? "default" : "pointer")};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;

  &:hover {
    background: ${({ theme, $disabled }) =>
      $disabled ? theme.colors.border + "30" : theme.colors.primary + "15"};
    border-color: ${({ theme, $disabled }) =>
      $disabled ? theme.colors.border : theme.colors.primary};
  }

  &:active {
    transform: ${({ $disabled }) => ($disabled ? "none" : "scale(0.96)")};
    background: ${({ theme, $disabled }) =>
      $disabled ? theme.colors.border + "30" : theme.colors.primary + "30"};
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
              const special = SPECIAL_KEYS.has(key);
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
                  $special={special}
                  $disabled={disabled}
                  type="button"
                  tabIndex={-1}
                  onClick={() => handleClick(key, disabled)}
                >
                  {key === "BACKSPACE" ? (
                    <Delete size={22} />
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
