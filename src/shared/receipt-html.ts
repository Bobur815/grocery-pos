/**
 * Shared receipt HTML builder — used by both the frontend preview and backend printing.
 * Pure function, no Node/Electron dependencies.
 */
import { formatPhone } from './utils/phone';

export interface ReceiptItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  barcode?: string;
  mxik?: string;
}

export interface ReceiptData {
  receiptNumber: string;
  createdAt: string; // ISO string or formatted
  cashierName: string;
  items: ReceiptItem[];
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  paymentMethod: string;
  /** Fiscal receipt number (REGOS:VCR) — replaces internal receipt number when set */
  fiscalReceiptNumber?: string;
  /** Fiscal mark (OFD URL `s` param) shown above QR code */
  fiscalMark?: string;
  /** Base64-encoded QR code PNG for the Soliq OFD URL (1% cashback for customer) */
  fiscalQrBase64?: string;
}

export type ReceiptLogoPosition = "top" | "bottom";

export interface ReceiptSettings {
  receipt_width: "80" | "58";
  receipt_language: "ru" | "uz";
  receipt_header: string;
  receipt_footer: string;
  store_name: string;
  store_address: string;
  store_phone: string;
  store_stir?: string;
  tax_rate?: string;
  tax_rate_as_discount?: string;
  /** Base64 data URL of the image printed above the store header ("" = none) */
  receipt_logo_top?: string;
  /** Top image width as a percentage of the paper width (e.g. "50") */
  receipt_logo_top_size?: string;
  /** Base64 data URL of the image printed below the footer ("" = none) */
  receipt_logo_bottom?: string;
  /** Bottom image width as a percentage of the paper width (e.g. "50") */
  receipt_logo_bottom_size?: string;
}

const labels: Record<string, Record<string, string>> = {
  ru: {
    receipt: "Чек №",
    date: "Дата",
    time: "Время",
    cashier: "Кассир",
    positions: "Позиций",
    subtotal: "Подитог",
    discount: "Скидка",
    total: "ИТОГО",
    payment: "Оплата",
    cash: "Наличные",
    card: "Карта",
    mixed: "Смешанная",
    currency: "сум",
    thankYou: "Спасибо за покупку!",
    testTitle: "ТЕСТОВАЯ ПЕЧАТЬ",
    testMessage: "Если вы видите этот текст, принтер работает корректно.",
    cashback: "Кешбэк 1% — отсканируйте QR",
    fiscalMark: "Fiskal belgi",
    taxDiscount: "Chegirma",
  },
  uz: {
    receipt: "Chek №",
    date: "Sana",
    time: "Vaqt",
    cashier: "Kassir",
    positions: "Pozitsiyalar",
    subtotal: "Oraliq jami",
    discount: "Chegirma",
    total: "JAMI",
    payment: "To'lov",
    cash: "Naqd",
    card: "Karta",
    mixed: "Aralash",
    currency: "so'm",
    thankYou: "Xaridingiz uchun rahmat!",
    testTitle: "TEST CHOP ETISH",
    testMessage: "Agar siz bu matnni ko'rsangiz, printer to'g'ri ishlayapti.",
    cashback: "1% cashback — QR kodni skanerlang",
    fiscalMark: "Fiskal belgi",
    taxDiscount: "Chegirma",
  },
};

function fmt(amount: number, currency: string): string {
  return amount.toLocaleString("ru-RU") + " " + currency;
}


/** Only base64 image data URLs are accepted — anything else is dropped, not printed. */
const LOGO_DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Renders the logo/QR block for one end of the receipt, or "" when no valid
 * image is configured there. Top and bottom images are independent.
 */
function logoHTML(
  settings: ReceiptSettings,
  position: ReceiptLogoPosition,
): string {
  const src = (
    (position === "top"
      ? settings.receipt_logo_top
      : settings.receipt_logo_bottom) || ""
  ).trim();
  if (!src || !LOGO_DATA_URL_RE.test(src)) return "";

  const rawSize =
    (position === "top"
      ? settings.receipt_logo_top_size
      : settings.receipt_logo_bottom_size) || "50";
  const size = Math.min(100, Math.max(10, parseInt(rawSize, 10) || 50));
  return `<div class="logo-block"><img src="${src}" style="width: ${size}%" alt="" /></div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseStyles(widthMm: number): string {
  const sm = widthMm === 58;
  return `
    @page { size: ${widthMm}mm auto; margin: 0; padding: 0; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { margin: 0 !important; padding: 0 !important; }
    body {
      font-family: 'Segoe UI', 'Arial', 'Liberation Sans', sans-serif;
      font-size: ${sm ? "13px" : "15px"};
      font-weight: 400;
      width: ${widthMm}mm;
      max-width: 100%;
      padding: 2mm 11mm 2mm 0 !important;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
    }
    .center { text-align: center; }
    .brand { font-size: ${sm ? "17px" : "20px"}; font-weight: 700; margin-bottom: 2px; }
    .sub { font-size: ${sm ? "12px" : "14px"}; font-weight: 400; color: #000; }
    hr {
      border: none;
      border-top: 1px dashed #000;
      margin: 4px 0;
    }
    hr.double {
      border-top: 2px solid #000;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 1px 6px;
    }
    .meta-grid .label { font-weight: 600; white-space: nowrap; }
    .meta-grid .value { text-align: right; }
    .item-row { margin: 3px 0; }
    .item-name { font-weight: 600; font-size: ${sm ? "13px" : "15px"}; }
    .item-detail {
      display: flex;
      justify-content: space-between;
      padding-left: 10px;
      font-size: ${sm ? "12px" : "14px"};
    }
    .item-meta {
      padding-left: 10px;
      font-size: ${sm ? "11px" : "12px"};
      color: #000;
    }
    hr.item-sep {
      border: none;
      border-top: 1px dashed #000;
      margin: 3px 0;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 2px 0;
    }
    .total-row .dots {
      flex: 1;
      overflow: hidden;
      margin: 0 3px;
      min-width: 8px;
      color: #000;
      font-size: 10px;
      line-height: 1;
      letter-spacing: 1px;
    }
    .total-row.grand {
      font-size: ${sm ? "17px" : "20px"};
      font-weight: 700;
      margin: 4px 0;
    }
    .footer { margin-top: 6px; font-size: ${sm ? "12px" : "14px"}; color: #000; }
    .positions { font-size: ${sm ? "12px" : "14px"}; color: #000; }
    .fiscal-block { margin-top: 8px; text-align: center; }
    .fiscal-block img { width: ${sm ? "110px" : "135px"}; height: ${sm ? "110px" : "135px"}; display: block; margin: 4px auto; }
    .fiscal-label { font-size: ${sm ? "11px" : "12px"}; font-weight: 600; color: #000; }
    .fiscal-sub { font-size: ${sm ? "10px" : "11px"}; color: #000; margin-top: 2px; }
    .logo-block { text-align: center; margin: 4px 0; }
    .logo-block img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  `;
}

export function buildReceiptHTML(
  sale: ReceiptData,
  settings: ReceiptSettings,
): string {
  const lang = settings.receipt_language || "ru";
  const widthMm = Number(settings.receipt_width) || 80;
  const l = labels[lang] || labels.ru;
  const cur = l.currency;
  const taxRate = parseFloat(settings.tax_rate || "0") || 0;

  const dateObj = new Date(sale.createdAt);
  const dateStr = dateObj.toLocaleDateString(lang === "ru" ? "ru-RU" : "uz-UZ");
  const timeStr = dateObj.toLocaleTimeString(
    lang === "ru" ? "ru-RU" : "uz-UZ",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  const paymentLabel =
    sale.paymentMethod === "cash"
      ? l.cash
      : sale.paymentMethod === "card"
        ? l.card
        : l.mixed;

  const taxAsDiscount = settings.tax_rate_as_discount === "true" && taxRate > 0;

  let itemsHTML = "";
  sale.items.forEach((item, idx) => {
    const isLast = idx === sale.items.length - 1;
    const itemVat = taxRate > 0 ? item.subtotal * taxRate / 100 : 0;
    itemsHTML += `
      <div class="item-row">
        <div class="item-name">${idx + 1}. ${escapeHtml(item.productName)}</div>
        <div class="item-detail">
          <span>${item.quantity} × ${fmt(item.unitPrice, cur)}</span>
          <span>${fmt(item.subtotal, cur)}</span>
        </div>
        <div class="item-meta">sh.j. QQS ${taxRate}%: ${fmt(itemVat, cur)}</div>
        ${item.barcode ? `<div class="item-meta">Shtrix-kod: ${escapeHtml(item.barcode)}</div>` : ""}
        ${item.mxik ? `<div class="item-meta">MXIK: ${escapeHtml(item.mxik)}</div>` : ""}
      </div>${isLast ? "" : '<hr class="item-sep">'}`;
  });
  const totalVat = sale.finalAmount * taxRate / 100;
  const grandTotal = !taxAsDiscount ? sale.finalAmount + totalVat : sale.finalAmount;
  const vatHTML = `<div class="total-row">
      <span>sh.j. QQS ${taxRate}%</span><span class="dots">.....................................................</span>
      <span>${fmt(totalVat, cur)}</span>
    </div>`;

  const taxDiscountAmount = taxAsDiscount ? sale.finalAmount * taxRate / 100 : 0;
  const taxDiscountHTML = taxAsDiscount
    ? `<div class="total-row">
        <span>${(l as any).taxDiscount} (${taxRate}%)</span><span class="dots">.....................................................</span>
        <span>-${fmt(taxDiscountAmount, cur)}</span>
      </div>`
    : "";

  const discountHTML =
    sale.discountAmount > 0
      ? `<div class="total-row">
          <span>${l.discount}</span><span class="dots">.....................................................</span>
          <span>-${fmt(sale.discountAmount, cur)}</span>
        </div>`
      : "";

  const footerText = settings.receipt_footer || l.thankYou;

  const fiscalHTML = sale.fiscalQrBase64
    ? `<hr>
       <div class="fiscal-block">
         ${sale.fiscalMark ? `<div class="fiscal-label">${(l as any).fiscalMark}: ${escapeHtml(sale.fiscalMark)}</div>` : ''}
         <img src="data:image/png;base64,${sale.fiscalQrBase64}" alt="QR" />
         <div class="fiscal-sub">${(l as any).cashback}</div>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${baseStyles(widthMm)}</style></head>
<body>
  ${logoHTML(settings, "top")}
  <div class="center">
    ${settings.store_name ? `<div class="brand">${escapeHtml(settings.store_name)}</div>` : ""}
    ${settings.store_address ? `<div class="sub">${escapeHtml(settings.store_address)}</div>` : ""}
    ${settings.store_phone ? `<div class="sub">${escapeHtml(formatPhone(settings.store_phone))}</div>` : ""}
    ${settings.store_stir ? `<div class="sub">STIR: ${escapeHtml(settings.store_stir)}</div>` : ""}
    ${settings.receipt_header ? `<div class="sub">${escapeHtml(settings.receipt_header)}</div>` : ""}
  </div>

  <hr>

  <div class="meta-grid">
    <span class="label">${l.receipt}</span><span class="value">${escapeHtml(sale.fiscalReceiptNumber || sale.receiptNumber)}</span>
    <span class="label">${l.date}</span><span class="value">${dateStr} ${timeStr}</span>
    <span class="label">${l.cashier}</span><span class="value">${escapeHtml(sale.cashierName)}</span>
  </div>

  <hr class="double">

  ${itemsHTML}

  <hr>

  <div class="positions">${l.positions}: ${sale.items.length}</div>

  <hr>

  <div class="total-row">
    <span>${l.subtotal}</span><span class="dots">.....................................................</span>
    <span>${fmt(sale.totalAmount, cur)}</span>
  </div>
  ${discountHTML}
  ${vatHTML}
  ${taxDiscountHTML}
  <div class="total-row grand">
    <span>${l.total}</span><span class="dots">.....................................................</span>
    <span>${fmt(grandTotal, cur)}</span>
  </div>
  <div class="total-row">
    <span>${l.payment}</span><span class="dots">.....................................................</span>
    <span>${paymentLabel}</span>
  </div>

  <hr>

  <div class="center footer">${escapeHtml(footerText)}</div>

  ${fiscalHTML}

  ${logoHTML(settings, "bottom")}

</body></html>`;
}

export function buildTestReceiptHTML(settings: ReceiptSettings): string {
  const lang = settings.receipt_language || "ru";
  const widthMm = Number(settings.receipt_width) || 80;
  const l = labels[lang] || labels.ru;

  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ru" ? "ru-RU" : "uz-UZ");
  const timeStr = now.toLocaleTimeString(lang === "ru" ? "ru-RU" : "uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${baseStyles(widthMm)}</style></head>
<body>
  ${logoHTML(settings, "top")}
  <div class="center">
    <hr class="double">
    <div class="brand">${l.testTitle}</div>
    <hr class="double">
    <div style="margin: 8px 0;">${l.testMessage}</div>
    <div class="sub">${l.date}: ${dateStr} ${timeStr}</div>
    ${settings.store_name ? `<div class="sub" style="margin-top: 4px;">${escapeHtml(settings.store_name)}</div>` : ""}
    <hr class="double">
  </div>
  ${logoHTML(settings, "bottom")}
</body></html>`;
}

/** Build a sample receipt for the live preview in settings */
export function buildSampleReceiptHTML(settings: ReceiptSettings): string {
  const lang = settings.receipt_language || "ru";
  const sampleItems: ReceiptItem[] =
    lang === "ru"
      ? [
          {
            productName: "Хлеб белый",
            quantity: 2,
            unitPrice: 5000,
            subtotal: 10000,
          },
          {
            productName: "Молоко 1л",
            quantity: 1,
            unitPrice: 12000,
            subtotal: 12000,
          },
          {
            productName: "Сахар 1кг",
            quantity: 1,
            unitPrice: 14000,
            subtotal: 14000,
          },
        ]
      : [
          {
            productName: "Oq non",
            quantity: 2,
            unitPrice: 5000,
            subtotal: 10000,
          },
          {
            productName: "Sut 1l",
            quantity: 1,
            unitPrice: 12000,
            subtotal: 12000,
          },
          {
            productName: "Shakar 1kg",
            quantity: 1,
            unitPrice: 14000,
            subtotal: 14000,
          },
        ];

  const html = buildReceiptHTML(
    {
      receiptNumber: "000123",
      createdAt: new Date().toISOString(),
      cashierName: lang === "ru" ? "Иванов А." : "Aliyev A.",
      items: sampleItems,
      totalAmount: 36000,
      discountAmount: 0,
      finalAmount: 36000,
      paymentMethod: "cash",
    },
    settings,
  );

  // Override print-specific padding for accurate preview display:
  // Print uses 11mm right padding to compensate for ~5mm hardware left margin.
  // Preview should show balanced padding instead.
  return html.replace(
    "</style>",
    " body { padding: 2mm 2mm 2mm 3mm !important; }\n</style>",
  );
}
