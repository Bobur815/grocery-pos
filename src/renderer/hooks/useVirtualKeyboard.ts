import { useCallback, useState } from "react";

/**
 * On-screen keyboard wiring for a form.
 *
 * Every settings page that offers the keyboard needs the same three things: which field currently
 * has focus, whether the panel is open, and how to turn a key press into an edit of that field.
 * That boilerplate was being copied per page, so a page could quietly end up with a keyboard that
 * types into nothing — the field list and the setter map had to be kept in step by hand.
 *
 * The hook owns the first two and delegates only the third, because that is the part that really
 * differs: some pages hold one `useState` per field, others a single form object, and some need
 * the typed value sanitised (digits only for a PIN) or mirrored (Uzbek → Cyrillic transliteration)
 * on the way in. Passing an `edit` function rather than a finished string lets the caller keep
 * that logic where it already lives, and keeps this hook from knowing anything about the form.
 *
 * Text is appended at the end of the value; there is no cursor tracking. That matches the existing
 * behaviour on the Fiscal settings screen, and a touch user retyping a field is the common case.
 */

/** Applies one key press to a field's current text. */
export type KeyboardEdit = (previous: string) => string;

/**
 * The edit a single key press makes, or null when the key does nothing.
 *
 * Split out of the hook so it can be tested without a React renderer — this is where the rules
 * that are easy to get subtly wrong live (ENTER must not submit, BACKSPACE must not be swallowed
 * by `replacing`), and the repo has no component-testing setup to catch them in place.
 */
export function keyEdit(key: string, replacing: boolean): KeyboardEdit | null {
  // These are forms with their own submit button. A stray Enter from the on-screen keyboard
  // submitting a half-filled form is a worse outcome than Enter doing nothing.
  if (key === "ENTER") return null;
  // Deleting is always relative to what is there, never a replacement — otherwise the first
  // backspace on a `clearOnFirstKey` field would wipe the value instead of trimming a digit.
  if (key === "BACKSPACE") return (previous) => previous.slice(0, -1);
  return (previous) => (replacing ? key : previous + key);
}

export interface FieldOptions {
  /** Numeric field — the panel greys out its letters while this field has focus. */
  numeric?: boolean;
  /**
   * Replace the value on the first key after focus instead of appending to it.
   *
   * For a field that always holds a small pre-filled number — a copy count of 1, a label width of
   * 40 — appending is never what the tap meant: pressing "5" on a quantity of 1 should give 5, not
   * 15. This is the on-screen equivalent of the field being selected when you focus it. Backspace
   * is unaffected, so correcting the last digit still works.
   */
  clearOnFirstKey?: boolean;
}

export interface VirtualKeyboardController<F extends string> {
  /** Whether the panel is showing. */
  open: boolean;
  /** The field that will receive keys, or null before anything has been focused. */
  activeField: F | null;
  /** True when the focused field was registered as numeric — the panel disables its letters. */
  numeric: boolean;
  toggle: () => void;
  close: () => void;
  /** Spread onto an input to make it the keyboard's target while it has focus. */
  fieldProps: (field: F, opts?: FieldOptions) => { onFocus: () => void };
  onKeyPress: (key: string) => void;
}

interface ActiveField<F> extends FieldOptions {
  field: F;
  /** No key typed into this field yet — only meaningful with clearOnFirstKey. */
  pristine: boolean;
}

export function useVirtualKeyboard<F extends string>(
  applyEdit: (field: F, edit: KeyboardEdit) => void,
): VirtualKeyboardController<F> {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ActiveField<F> | null>(null);

  const onKeyPress = useCallback(
    (key: string) => {
      // Nothing focused yet — keys would otherwise land in whichever field was wired first.
      if (!active) return;

      const edit = keyEdit(key, Boolean(active.clearOnFirstKey) && active.pristine);
      if (!edit) return;

      if (active.pristine) setActive({ ...active, pristine: false });
      applyEdit(active.field, edit);
    },
    [active, applyEdit],
  );

  const fieldProps = useCallback(
    (field: F, opts?: FieldOptions) => ({
      onFocus: () => setActive({ field, pristine: true, ...opts }),
    }),
    [],
  );

  return {
    open,
    activeField: active?.field ?? null,
    numeric: Boolean(active?.numeric),
    toggle: useCallback(() => setOpen((v) => !v), []),
    close: useCallback(() => setOpen(false), []),
    fieldProps,
    onKeyPress,
  };
}
