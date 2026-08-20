import styled, { css } from "styled-components";
import { UZQR_BRAND_COLOR } from "@shared/constants";
import uzqrLogo from "../../assets/uzqr.png";

/** Intrinsic size of the artwork — width is derived from height, never guessed. */
const LOGO_W = 3000;
const LOGO_H = 3256;

/**
 * The UzQR wordmark on its own navy field.
 *
 * The artwork is transparent and its "Uz" and QR blocks are WHITE (only "Qr" is blue), so
 * the navy fill is not decoration — without it the mark is invisible on a light surface.
 * `contain` keeps it undistorted; `cover` would crop it.
 *
 * `$fill` picks the two shapes it has to take: the checkout tile wants the navy to span
 * the whole button with the mark centred in it, while the quick-pay button wants a small
 * square mark sitting beside its shortcut hint.
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
  background-color: ${UZQR_BRAND_COLOR};
  background-image: url(${uzqrLogo});
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 4px;
`;
