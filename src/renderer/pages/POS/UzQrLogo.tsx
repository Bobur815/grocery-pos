import styled, { css } from "styled-components";
import uzqrLogo from "../../assets/uzqr.png";

/** Intrinsic size of the artwork — width is derived from height, never guessed. */
const LOGO_W = 3000;
const LOGO_H = 3256;

/**
 * The UzQR wordmark, drawn transparent so the button underneath supplies the field.
 *
 * The artwork's "Uz" and QR blocks are WHITE (only "Qr" is blue), so it is only legible on
 * a dark ground. This component deliberately does NOT paint one: both callers already
 * paint themselves `UZQR_BRAND_COLOR`, and a second fill here just drew a box inside the
 * button. Any new caller must put the mark on a dark background — on `surface` in the
 * light theme it would be invisible. `contain` keeps it undistorted; `cover` would crop it.
 *
 * `$fill` picks the two shapes it has to take: the checkout tile wants the mark to span
 * the whole button, while the quick-pay button wants a small square mark sitting beside
 * its shortcut hint.
 *
 * Lives under pages/POS rather than components/common: `common` is the surface the web
 * dashboard also compiles, and this asset is POS-only.
 *
 * Purely decorative — every caller is a button that carries its own accessible name.
 */
export const UzQrLogo = styled.span<{ $height?: number; $fill?: boolean }>`
  display: block;
  height: ${({ $height }) => $height ?? 40}px;
  ${({ $fill }) =>
    $fill
      ? css`
          width: 100%;
        `
      : css`
          aspect-ratio: ${LOGO_W} / ${LOGO_H};
          width: auto;
          max-width: 100%;
        `}
  background-image: url(${uzqrLogo});
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 4px;
`;
