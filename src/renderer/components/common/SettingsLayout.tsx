import styled from "styled-components";

/**
 * Layout primitives for the settings screens.
 *
 * These pages were each a single narrow column — capped at 600–800px on a terminal that is far
 * wider — so half the screen sat empty while the content ran off the bottom. On a POS the scroll
 * is the expensive part: it is a touch screen, often at eye level, and every section pushed below
 * the fold is one a cashier has to hunt for.
 *
 * The fix is the same everywhere: let the cards flow into as many columns as the screen affords,
 * and let a card that is genuinely wide (a form with paired fields, a table) opt out and span.
 * Everything here is `auto-fit` + `minmax`, so a narrow window collapses back to one column on its
 * own with no breakpoints to keep in sync.
 */

/** Page width. Wide enough for three cards, capped so text lines stay readable. */
export const SettingsPage = styled.div`
  max-width: 1180px;
`;

/**
 * Cards flow into columns as width allows: one below ~760px, two below ~1120px, three above.
 *
 * `align-items: start` matters — without it every card in a row stretches to the tallest, so a
 * two-line card next to a long form becomes a mostly-empty box.
 */
export const SettingsGrid = styled.div<{ $min?: number }>`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(${({ $min }) => $min ?? 340}px, 1fr));
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;
`;

/** For a card that needs the full width whatever the column count — a wide form, or a table. */
export const SpanAll = styled.div`
  grid-column: 1 / -1;
`;

/**
 * Fields side by side inside a card, collapsing to one column when the card is narrow.
 *
 * 220px is deliberately small: these hold short values (a rate, a port, an ID), and pairing them
 * is what stops a settings form from being twenty rows tall.
 */
export const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  align-items: start;
`;

/** A labelled group inside a card, for forms long enough to need signposting. */
export const GroupTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding-bottom: ${({ theme }) => theme.spacing.xs};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  margin-top: ${({ theme }) => theme.spacing.sm};

  &:first-child {
    margin-top: 0;
  }
`;
