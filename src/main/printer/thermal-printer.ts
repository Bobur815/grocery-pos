import { ipcMain, BrowserWindow } from "electron";
import { spawn } from "child_process";
import QRCode from "qrcode";
import { getPrismaClient } from "../database/sqlite-client";
import {
  buildReceiptHTML,
  buildTestReceiptHTML,
} from "../../shared/receipt-html";
import type { ReceiptData, ReceiptSettings } from "../../shared/receipt-html";
import { printPriceTagsTSPL } from "./tspl-printer";
import type { TsplPrintRequest } from "./tspl-printer";

interface PrinterConfig {
  name: string;
  type: "thermal" | "standard";
  width: number; // characters per line
}

let printerConfig: PrinterConfig = {
  name: process.env.PRINTER_NAME || "",
  type: "thermal",
  width: 42, // Standard thermal printer width
};

export interface WeightedLabelData {
  productNameRu: string;
  productNameUz: string;
  internalCode: string;
  barcode: string;
  weightKg: number;
  pricePerKg: number;
  totalPrice: number;
  date: string;
}

export function setupPrinterHandlers(): void {
  ipcMain.handle("printer:printReceipt", async (_event, saleId: string) => {
    return printReceipt(saleId);
  });

  ipcMain.handle("printer:testPrint", async () => {
    return testPrint();
  });

  ipcMain.handle("printer:getAvailable", async () => {
    return getAvailablePrinters();
  });

  ipcMain.handle(
    "printer:printPriceTags",
    async (_event, html: string, widthMm: number, heightMm: number) => {
      return printPriceTags(html, widthMm, heightMm);
    },
  );

  ipcMain.handle(
    "printer:printWeightedLabel",
    async (_event, data: WeightedLabelData) => {
      return printWeightedLabel(data);
    },
  );

  ipcMain.handle("printer:openCashDrawer", async () => {
    await openCashDrawer();
    return true;
  });

  // Test handler — bypasses cash_drawer_enabled check, uses saved printer_name directly
  ipcMain.handle("printer:testOpenCashDrawer", async () => {
    const prisma = getPrismaClient();
    const row = await prisma.systemSetting.findFirst({ where: { key: "printer_name" } });
    const name = row?.value || printerConfig.name;
    if (!name) throw new Error("No printer configured");
    await openCashDrawerRaw(name);
    return true;
  });

  ipcMain.handle(
    "printer:printPriceTagsTSPL",
    async (_event, req: TsplPrintRequest) => {
      await printPriceTagsTSPL(req);
      return true;
    },
  );
}

async function getAvailablePrinters(): Promise<string[]> {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) {
    return [];
  }

  const printers = await window.webContents.getPrintersAsync();
  return printers.map((p) => p.name);
}

async function loadReceiptSettings(): Promise<ReceiptSettings> {
  const prisma = getPrismaClient();
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: {
        in: [
          "store_name",
          "store_address",
          "store_phone",
          "store_stir",
          "tax_rate",
          "receipt_header",
          "receipt_footer",
          "receipt_width",
          "receipt_language",
          "tax_rate_as_discount",
        ],
      },
    },
  });

  const map = rows.reduce(
    (acc: Record<string, string>, s: { key: string; value: string }) => ({
      ...acc,
      [s.key]: s.value,
    }),
    {} as Record<string, string>,
  );

  return {
    store_name: map.store_name || "",
    store_address: map.store_address || "",
    store_phone: map.store_phone || "",
    store_stir: map.store_stir || "",
    tax_rate: map.tax_rate || "0",
    receipt_header: map.receipt_header || "",
    receipt_footer: map.receipt_footer || "",
    receipt_width: (map.receipt_width as "80" | "58") || "80",
    receipt_language: (map.receipt_language as "ru" | "uz") || "ru",
    tax_rate_as_discount: map.tax_rate_as_discount || "false",
  };
}

async function printReceipt(saleId: string): Promise<boolean> {
  const prisma = getPrismaClient();

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { items: { include: { product: true } } },
  });

  if (!sale) {
    throw new Error("Sale not found");
  }

  const settings = await loadReceiptSettings();

  // Generate the Soliq OFD QR for the customer (1% cashback). Fiscal data comes
  // from REGOS:VCR (ofd.soliq.uz).
  let fiscalQrBase64: string | undefined;
  let fiscalMark: string | undefined;
  const regosQrCodeUrl = (sale as any).regosQrCodeUrl as string | null;
  const regosReceiptNo = (sale as any).regosReceiptNo as string | null;
  const fiscalUrl = regosQrCodeUrl;
  const fiscalReceiptNo = regosReceiptNo;
  if (fiscalUrl) {
    try {
      const ofdParams = new URL(fiscalUrl).searchParams;
      fiscalMark = ofdParams.get('s') || undefined;
      const dataUrl = await QRCode.toDataURL(fiscalUrl, { margin: 1, width: 300 });
      fiscalQrBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    } catch (err) {
      console.error('[Printer] QR code generation failed:', err);
    }
  }

  const receiptData: ReceiptData = {
    receiptNumber: sale.receiptNumber,
    createdAt: sale.createdAt.toISOString(),
    cashierName: sale.cashierName,
    items: sale.items.map(
      (item: {
        productName: string;
        quantity: unknown;
        unitPrice: unknown;
        subtotal: unknown;
        barcode: string;
        product?: { mxik?: string | null };
      }) => ({
        productName: item.productName,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
        barcode: item.barcode,
        mxik: item.product?.mxik || undefined,
      }),
    ),
    totalAmount: Number(sale.totalAmount),
    discountAmount: Number(sale.discountAmount),
    finalAmount: Number(sale.finalAmount),
    paymentMethod: sale.paymentMethod,
    fiscalReceiptNumber: fiscalReceiptNo || undefined,
    fiscalMark,
    fiscalQrBase64,
  };

  const html = buildReceiptHTML(receiptData, settings);
  const widthMm = Number(settings.receipt_width) || 80;

  const result = await printHTML(html, widthMm);

  if (sale.paymentMethod === "cash" || sale.paymentMethod === "mixed") {
    openCashDrawer().catch((err) =>
      console.error("[Printer] Cash drawer error:", err)
    );
  }

  return result;
}

async function printHTML(html: string, widthMm: number): Promise<boolean> {
  if (!printerConfig.name) {
    return true;
  }

  const widthMicrons = widthMm * 1000;

  // Render at 4× scale (384 effective DPI) so the 203 DPI printer downsamples
  // rather than upsamples — downsampling always produces sharper text than upscaling.
  // Physical window width must also scale so CSS mm values lay out correctly.
  const SCALE = 4;
  const printWindow = new BrowserWindow({
    show: false,
    width: (Math.round(widthMm * 3.78) + 20) * SCALE,
    height: 2400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );

    // Scale up rendering so the printer downsamples (sharper text)
    printWindow.webContents.setZoomFactor(SCALE);

    // Small delay for rendering
    await new Promise((resolve) => setTimeout(resolve, 200));

    return await new Promise<boolean>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerConfig.name,
          // No custom pageSize — let the Windows driver use its configured paper size.
          // Overriding pageSize confuses thermal GDI drivers (job queues but printer blinks/ignores).
          // Configure 58mm roll paper once in Windows → Devices and Printers → XP-58 → Printing Preferences.
          margins: {
            marginType: "none",
          },
        } as Electron.WebContentsPrintOptions,
        (success, errorType) => {
          if (!success) console.error(`[Printer] failed: errorType=${errorType} printer="${printerConfig.name}"`);
          if (success) {
            resolve(true);
          } else {
            reject(new Error(`Print failed: ${errorType}`));
          }
        },
      );
    });
  } finally {
    printWindow.destroy();
  }
}

async function testPrint(): Promise<boolean> {
  const settings = await loadReceiptSettings();
  const html = buildTestReceiptHTML(settings);
  const widthMm = Number(settings.receipt_width) || 80;
  return printHTML(html, widthMm);
}

async function printPriceTags(
  html: string,
  widthMm: number,
  heightMm: number,
): Promise<boolean> {
  // Load printer name from settings (same setting as weighted labels)
  const prisma = getPrismaClient();
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ["label_printer_name"] } },
  });
  const map = rows.reduce(
    (acc: Record<string, string>, s: { key: string; value: string }) => ({
      ...acc,
      [s.key]: s.value,
    }),
    {} as Record<string, string>,
  );
  const printerName = map.label_printer_name || printerConfig.name;

  // Always use portrait: swap page dimensions when template is landscape (widthMm > heightMm)
  const isLandscape = widthMm > heightMm;
  const pageSizeWidth = (isLandscape ? heightMm : widthMm) * 1000;
  const pageSizeHeight = (isLandscape ? widthMm : heightMm) * 1000;

  const maxSide = Math.max(widthMm, heightMm);

  return new Promise((resolve, reject) => {
    const printWindow = new BrowserWindow({
      show: false,
      width: Math.round(maxSide * 3.78) + 20,
      height: Math.round(maxSide * 3.78) + 20,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );

    printWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        printWindow.webContents.print(
          {
            silent: !!printerName,
            printBackground: true,
            ...(printerName && { deviceName: printerName }),
            pageSize: {
              width: pageSizeWidth,
              height: pageSizeHeight,
            },
            margins: {
              marginType: "none",
            },
          } as Electron.WebContentsPrintOptions,
          (success, errorType) => {
            printWindow.destroy();
            if (success) {
              resolve(true);
            } else {
              reject(new Error(`Price tag print failed: ${errorType}`));
            }
          },
        );
      }, 200);
    });
  });
}

async function printWeightedLabel(data: WeightedLabelData): Promise<boolean> {
  const prisma = getPrismaClient();
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ["label_printer_name", "label_width_mm"] } },
  });
  const map = rows.reduce(
    (acc: Record<string, string>, s: { key: string; value: string }) => ({
      ...acc,
      [s.key]: s.value,
    }),
    {} as Record<string, string>,
  );

  const labelPrinterName = map.label_printer_name || printerConfig.name;
  const widthMm = parseInt(map.label_width_mm || "58", 10) || 58;
  const heightMm = 40;

  const formattedWeight = data.weightKg.toFixed(3);
  const formattedPrice = Math.round(data.pricePerKg).toLocaleString("ru-RU");
  const formattedTotal = Math.round(data.totalPrice).toLocaleString("ru-RU");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    font-family: Arial, sans-serif;
    padding: 2mm;
    overflow: hidden;
  }
  .label { display: flex; flex-direction: column; height: 100%; }
  .name { font-size: 9pt; font-weight: bold; line-height: 1.1; margin-bottom: 1mm; }
  .row { display: flex; justify-content: space-between; font-size: 8pt; margin-bottom: 0.5mm; }
  .total { font-size: 14pt; font-weight: bold; text-align: center; margin: 1mm 0; }
  .barcode-text { font-size: 6pt; text-align: center; font-family: monospace; letter-spacing: 1px; }
  .barcode-bars { text-align: center; font-size: 28pt; font-family: 'Libre Barcode 128', monospace; line-height: 1; }
  .date { font-size: 6pt; color: #666; text-align: right; margin-top: auto; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1mm 0; }
</style>
</head>
<body>
<div class="label">
  <div class="name">${data.productNameRu}</div>
  <hr/>
  <div class="row">
    <span>Вес: <b>${formattedWeight} кг</b></span>
    <span>Цена/кг: <b>${formattedPrice}</b></span>
  </div>
  <div class="total">${formattedTotal} сум</div>
  <hr/>
  <div class="barcode-text">${data.barcode}</div>
  <div class="date">${data.date} | ${data.internalCode}</div>
</div>
</body>
</html>`;

  // Use label-specific printer if configured, otherwise fall back to default
  const origName = printerConfig.name;
  if (labelPrinterName && labelPrinterName !== origName) {
    printerConfig = { ...printerConfig, name: labelPrinterName };
    const result = await printHTML(html, widthMm);
    printerConfig = { ...printerConfig, name: origName };
    return result;
  }

  return printHTML(html, widthMm);
}

// Sends ESC/POS cash drawer kick command via Windows raw print API (no extra npm packages).
// Works with any USB printer that has a driver installed — bypasses the spooler's GDI pipeline.
async function openCashDrawerRaw(printerName: string): Promise<void> {
  // ESC p 0 t1 t2 — kick drawer port 2, on=50ms, off=500ms
  const kickBytes = "0x1B,0x70,0x00,0x19,0xFA";

  const psScript = `
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class RawPrint{
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  public struct DOCINFO{[MarshalAs(UnmanagedType.LPWStr)]public string pDocName;[MarshalAs(UnmanagedType.LPWStr)]public string pOutputFile;[MarshalAs(UnmanagedType.LPWStr)]public string pDataType;}
  [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
  [DllImport("winspool.drv",SetLastError=true)]public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]public static extern int StartDocPrinter(IntPtr h,int l,ref DOCINFO d);
  [DllImport("winspool.drv",SetLastError=true)]public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]public static extern bool WritePrinter(IntPtr h,IntPtr b,int c,out int w);
  public static bool Send(string name,byte[] data){
    IntPtr h;if(!OpenPrinter(name,out h,IntPtr.Zero))return false;
    var d=new DOCINFO{pDocName="Drawer",pOutputFile=null,pDataType="RAW"};
    if(StartDocPrinter(h,1,ref d)<=0){ClosePrinter(h);return false;}
    StartPagePrinter(h);
    IntPtr b=Marshal.AllocCoTaskMem(data.Length);Marshal.Copy(data,0,b,data.Length);int w;
    WritePrinter(h,b,data.Length,out w);Marshal.FreeCoTaskMem(b);
    EndPagePrinter(h);EndDocPrinter(h);ClosePrinter(h);return w==data.Length;}
}
"@
$ok = [RawPrint]::Send('${printerName.replace(/'/g, "''")}', [byte[]](${kickBytes}))
if (-not $ok) { Write-Error "OpenPrinter/WritePrinter failed for '${'${printerName}'}'" ; exit 1 }
`;

  return new Promise((resolve, reject) => {
    const ps = spawn("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript,
    ]);
    let stderr = "";
    ps.stderr?.on("data", (d) => { stderr += d.toString(); });
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Cash drawer command failed (exit ${code}): ${stderr.trim()}`));
    });
    ps.on("error", reject);
  });
}

export async function openCashDrawer(): Promise<void> {
  const prisma = getPrismaClient();
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ["cash_drawer_enabled", "printer_name"] } },
  });
  const map = rows.reduce(
    (acc: Record<string, string>, s: { key: string; value: string }) => ({
      ...acc,
      [s.key]: s.value,
    }),
    {} as Record<string, string>
  );

  if (map.cash_drawer_enabled !== "true") { console.log("[Drawer] disabled, skipping"); return; }
  const name = map.printer_name || printerConfig.name;
  if (!name) { console.log("[Drawer] no printer name configured"); return; }

  await openCashDrawerRaw(name);
}

export function setPrinterConfig(config: Partial<PrinterConfig>): void {
  printerConfig = { ...printerConfig, ...config };
}

export function getPrinterConfig(): PrinterConfig {
  return { ...printerConfig };
}

export { loadReceiptSettings };

export async function printRawHTML(html: string, widthMm: number): Promise<boolean> {
  return printHTML(html, widthMm);
}
