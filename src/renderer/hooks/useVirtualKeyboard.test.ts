/**
 * The on-screen keyboard's key rules.
 *
 * Every settings form now routes its typing through this, so a mistake here is a mistake on every
 * screen at once — and the repo has no component-testing setup that would catch it in place.
 */

import { keyEdit } from './useVirtualKeyboard';

/** Applies a run of key presses the way the hook does, appending after the first. */
function type(start: string, keys: string[], clearOnFirstKey = false): string {
  let value = start;
  let pristine = true;
  for (const key of keys) {
    const edit = keyEdit(key, clearOnFirstKey && pristine);
    if (!edit) continue;
    value = edit(value);
    pristine = false;
  }
  return value;
}

describe('keyEdit', () => {
  it('appends a character to what is already there', () => {
    expect(keyEdit('a', false)!('Nov')).toBe('Nova');
  });

  it('deletes the last character on BACKSPACE', () => {
    expect(keyEdit('BACKSPACE', false)!('Nova')).toBe('Nov');
  });

  it('is a no-op backspacing an empty field rather than throwing', () => {
    expect(keyEdit('BACKSPACE', false)!('')).toBe('');
  });

  it('does nothing at all on ENTER', () => {
    // The forms have their own submit button; a stray Enter must not submit a half-filled form.
    expect(keyEdit('ENTER', false)).toBeNull();
  });

  it('replaces instead of appending when the field is being retyped', () => {
    expect(keyEdit('5', true)!('1')).toBe('5');
  });

  it('never lets `replacing` turn a backspace into a wipe', () => {
    // The first press on a clearOnFirstKey field can be a backspace — trimming a digit off a
    // pre-filled width, say. That must still trim, not blank the field.
    expect(keyEdit('BACKSPACE', true)!('40')).toBe('4');
  });
});

describe('typing a sequence', () => {
  it('builds up a value key by key', () => {
    expect(type('', ['a', 'b', 'c'])).toBe('abc');
  });

  it('appends to an existing value by default', () => {
    // Right for a name or an address, where focus lands to continue an edit.
    expect(type('Nov', ['a'])).toBe('Nova');
  });

  it('retypes a pre-filled quantity instead of appending to it', () => {
    // The bug this exists to prevent: tapping "5" on a copy count of 1 must give 5, not 15.
    expect(type('1', ['5'], true)).toBe('5');
  });

  it('only replaces once, then appends for the rest of the entry', () => {
    expect(type('40', ['1', '2', '5'], true)).toBe('125');
  });

  it('keeps replacing behaviour out of the way of corrections', () => {
    expect(type('40', ['BACKSPACE', '5'], true)).toBe('45');
  });

  it('ignores ENTER mid-sequence without disturbing what follows', () => {
    expect(type('', ['a', 'ENTER', 'b'])).toBe('ab');
  });

  it('does not let a leading ENTER consume the field\'s one replacement', () => {
    // ENTER is inert, so it must not count as "the first key" and leave the next press appending.
    expect(type('1', ['ENTER', '5'], true)).toBe('5');
  });
});
