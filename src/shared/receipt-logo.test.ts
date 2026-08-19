import {
  buildSampleReceiptHTML,
  buildTestReceiptHTML,
  type ReceiptSettings,
} from './receipt-html';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

const BLOCK = 'class="logo-block"';

const base: ReceiptSettings = {
  receipt_width: '80',
  receipt_language: 'ru',
  receipt_header: '',
  receipt_footer: '',
  store_name: 'Test Store',
  store_address: '',
  store_phone: '',
};

/** Index of the nth logo block in the document, or -1 */
function blockIndex(html: string, nth = 0): number {
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = html.indexOf(BLOCK, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

test('no images → no logo block', () => {
  expect(buildSampleReceiptHTML(base)).not.toContain(BLOCK);
});

test('top image renders before the store name', () => {
  const html = buildSampleReceiptHTML({
    ...base,
    receipt_logo_top: PNG,
    receipt_logo_top_size: '70',
  });
  expect(html).toContain('width: 70%');
  expect(blockIndex(html)).toBeLessThan(html.indexOf('Test Store'));
  expect(blockIndex(html, 1)).toBe(-1);
});

test('bottom image renders after the store name', () => {
  const html = buildSampleReceiptHTML({ ...base, receipt_logo_bottom: PNG });
  expect(blockIndex(html)).toBeGreaterThan(html.indexOf('Test Store'));
  expect(html).toContain('width: 50%');
  expect(blockIndex(html, 1)).toBe(-1);
});

test('top and bottom images are independent — both render, each with its own size', () => {
  const html = buildSampleReceiptHTML({
    ...base,
    receipt_logo_top: PNG,
    receipt_logo_top_size: '30',
    receipt_logo_bottom: JPEG,
    receipt_logo_bottom_size: '100',
  });

  const top = blockIndex(html);
  const bottom = blockIndex(html, 1);
  expect(top).toBeGreaterThan(-1);
  expect(bottom).toBeGreaterThan(top);
  expect(top).toBeLessThan(html.indexOf('Test Store'));
  expect(bottom).toBeGreaterThan(html.indexOf('Test Store'));

  expect(html.slice(top, bottom)).toContain('width: 30%');
  expect(html.slice(top, bottom)).toContain(PNG);
  expect(html.slice(bottom)).toContain('width: 100%');
  expect(html.slice(bottom)).toContain(JPEG);
});

test('an image in one slot does not leak into the other', () => {
  const html = buildSampleReceiptHTML({ ...base, receipt_logo_top: PNG });
  expect(html.slice(html.indexOf('Test Store'))).not.toContain(BLOCK);
});

test('non-image data URL is dropped', () => {
  const html = buildSampleReceiptHTML({
    ...base,
    receipt_logo_top: 'data:text/html;base64,PHNjcmlwdD4=',
    receipt_logo_bottom: 'https://example.com/logo.png',
  });
  expect(html).not.toContain(BLOCK);
});

test('size is clamped to 10–100%', () => {
  const html = buildSampleReceiptHTML({
    ...base,
    receipt_logo_top: PNG,
    receipt_logo_top_size: '999',
    receipt_logo_bottom: PNG,
    receipt_logo_bottom_size: '1',
  });
  expect(html).toContain('width: 100%');
  expect(html).toContain('width: 10%');
});

test('test print includes both images', () => {
  const html = buildTestReceiptHTML({
    ...base,
    receipt_logo_top: PNG,
    receipt_logo_bottom: JPEG,
  });
  expect(blockIndex(html, 1)).toBeGreaterThan(-1);
});
