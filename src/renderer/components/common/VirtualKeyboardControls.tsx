import React from "react";
import { Keyboard, ChevronDown, ChevronUp } from "lucide-react";
import { KbToggle } from "./SearchControls";
import { VirtualKeyboard } from "./VirtualKeyboard";
import type { VirtualKeyboardController } from "../../hooks/useVirtualKeyboard";

/**
 * The two bits of UI that go with `useVirtualKeyboard`: the button that shows the panel, and the
 * panel itself. Kept together so every screen offering the on-screen keyboard looks and behaves
 * the same — same icon, same chevron, same placement rules — instead of each page re-deriving it.
 *
 * Both take only the members that do not depend on the controller's field type, so a controller
 * for any field union can be passed without the call site restating it.
 */
type PanelControls = Pick<
  VirtualKeyboardController<string>,
  "open" | "numeric" | "toggle" | "close" | "onKeyPress"
>;

/**
 * Stacking level for a keyboard opened from a form inside a Modal.
 *
 * Modal's overlay is a full-screen `position: fixed` layer at z-index 1000, and the keyboard
 * defaults to 200 — so without this the panel renders *underneath* the modal's dimming layer and
 * is neither visible nor clickable. Pass it whenever the form lives in a modal.
 */
export const KEYBOARD_Z_ABOVE_MODAL = 1100;

interface ToggleProps {
  kb: PanelControls;
  style?: React.CSSProperties;
  title?: string;
}

export function KeyboardToggle({ kb, style, title }: ToggleProps) {
  return (
    <KbToggle
      type="button"
      // Neither focusable nor focus-stealing: the panel types into whichever field has focus, so
      // the toggle must not take it away. tabIndex keeps it out of the form's tab order too.
      tabIndex={-1}
      $active={kb.open}
      onMouseDown={(e) => e.preventDefault()}
      onClick={kb.toggle}
      style={style}
      title={title}
    >
      <Keyboard size={18} />
      {kb.open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </KbToggle>
  );
}

interface PanelProps {
  kb: PanelControls;
  /** Raise above a modal when the form lives in one; omit for a plain page. */
  zIndex?: number;
}

export function KeyboardPanel({ kb, zIndex }: PanelProps) {
  if (!kb.open) return null;
  return (
    <VirtualKeyboard
      fixed
      zIndex={zIndex}
      // Follows focus: moving from a text field to a numeric one greys out the letters rather
      // than letting someone type "abc" into a price.
      numbersOnly={kb.numeric}
      onKeyPress={kb.onKeyPress}
      onClose={kb.close}
    />
  );
}
