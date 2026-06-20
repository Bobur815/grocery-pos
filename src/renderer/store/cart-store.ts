import { create } from 'zustand';

export interface CartItem {
  productId: number;
  productName: string;
  barcode: string;
  unitPrice: number;
  quantity: number;
  stock: number;
  unit?: string;
  preWeighedItemId?: string; // Set when item came from pre-weighed inventory; never merge
  markingCode?: string;      // Set when item is a group 022 unique QR scan; never merge
}

interface TabCart {
  items: CartItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  discount: number;
  total: number;
  itemCount: number;
  editingSaleId: string | null;
  editingSaleReceipt: string | null;
}

function emptyTabCart(): TabCart {
  return { items: [], subtotal: 0, taxRate: 0, tax: 0, discount: 0, total: 0, itemCount: 0, editingSaleId: null, editingSaleReceipt: null };
}

let tabCounter = 1;
const firstTabId = `tab-${tabCounter}`;

interface CartState {
  tabs: Record<string, TabCart>;
  tabOrder: string[];
  activeTabId: string;

  // Tab management
  addTab: () => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Cart operations (operate on active tab)
  addItem: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void;
  removeItem: (productId: number, unitPrice?: number) => void;
  removeByMarkingCode: (markingCode: string) => void;
  updateQuantity: (productId: number, quantity: number, unitPrice?: number) => void;
  setDiscount: (discount: number) => void;
  setTaxRate: (rate: number) => void;
  clearCart: () => void;
  loadSaleForEdit: (saleId: string, receiptNumber: string, items: CartItem[]) => void;

  // Computed from active tab (kept flat for backward compat)
  items: CartItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  discount: number;
  total: number;
  itemCount: number;
  editingSaleId: string | null;
  editingSaleReceipt: string | null;
}

function activeCart(state: CartState): TabCart {
  return state.tabs[state.activeTabId] || emptyTabCart();
}

function flatFromActive(tabs: Record<string, TabCart>, activeTabId: string) {
  const cart = tabs[activeTabId] || emptyTabCart();
  return {
    items: cart.items,
    subtotal: cart.subtotal,
    taxRate: cart.taxRate,
    tax: cart.tax,
    discount: cart.discount,
    total: cart.total,
    itemCount: cart.itemCount,
    editingSaleId: cart.editingSaleId,
    editingSaleReceipt: cart.editingSaleReceipt,
  };
}

export const useCartStore = create<CartState>((set, get) => ({
  tabs: { [firstTabId]: emptyTabCart() },
  tabOrder: [firstTabId],
  activeTabId: firstTabId,

  // Flat fields from active tab
  ...flatFromActive({ [firstTabId]: emptyTabCart() }, firstTabId),

  addTab: () => {
    tabCounter++;
    const newId = `tab-${tabCounter}`;
    const { tabs, tabOrder } = get();
    const newTabs = { ...tabs, [newId]: emptyTabCart() };
    set({
      tabs: newTabs,
      tabOrder: [...tabOrder, newId],
      activeTabId: newId,
      ...flatFromActive(newTabs, newId),
    });
    return newId;
  },

  removeTab: (tabId) => {
    const { tabs, tabOrder, activeTabId } = get();
    if (tabOrder.length <= 1) return; // Can't remove last tab

    const newTabOrder = tabOrder.filter((id) => id !== tabId);
    const newTabs = { ...tabs };
    delete newTabs[tabId];

    let newActiveId = activeTabId;
    if (activeTabId === tabId) {
      const oldIndex = tabOrder.indexOf(tabId);
      newActiveId = newTabOrder[Math.min(oldIndex, newTabOrder.length - 1)];
    }

    set({
      tabs: newTabs,
      tabOrder: newTabOrder,
      activeTabId: newActiveId,
      ...flatFromActive(newTabs, newActiveId),
    });
  },

  setActiveTab: (tabId) => {
    const { tabs } = get();
    if (!tabs[tabId]) return;
    set({
      activeTabId: tabId,
      ...flatFromActive(tabs, tabId),
    });
  },

  addItem: (item) => {
    const state = get();
    const cart = activeCart(state);

    // Pre-weighed items and marking-code items are never merged — each is a unique scan
    const canMerge = !item.preWeighedItemId && !item.markingCode;
    const existingIndex = canMerge
      ? cart.items.findIndex(
          (i) => i.productId === item.productId && i.unitPrice === item.unitPrice && !i.preWeighedItemId && !i.markingCode
        )
      : -1;

    let newItems: CartItem[];

    if (existingIndex >= 0) {
      newItems = cart.items.map((i, index) => {
        if (index === existingIndex) {
          const newQuantity = Math.min(i.quantity + (item.quantity || 1), i.stock);
          return { ...i, quantity: newQuantity };
        }
        return i;
      });
    } else {
      newItems = [...cart.items, { ...item, quantity: item.quantity || 1 }];
    }

    const totals = calculateTotals(newItems, cart.taxRate, cart.discount);
    const updatedCart = { ...cart, items: newItems, ...totals };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({ tabs: newTabs, items: newItems, ...totals });
  },

  removeItem: (productId, unitPrice?) => {
    const state = get();
    const cart = activeCart(state);
    const newItems = cart.items.filter((i) =>
      unitPrice !== undefined
        ? !(i.productId === productId && i.unitPrice === unitPrice)
        : i.productId !== productId
    );
    const totals = calculateTotals(newItems, cart.taxRate, cart.discount);
    const updatedCart = { ...cart, items: newItems, ...totals };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({ tabs: newTabs, items: newItems, ...totals });
  },

  // Remove the single cart line carrying this marking code (group-022 scans are never merged,
  // so each maps to exactly one line). Used to revert an optimistic add when a background
  // resale check reports the code already sold.
  removeByMarkingCode: (markingCode) => {
    const state = get();
    const cart = activeCart(state);
    const newItems = cart.items.filter((i) => i.markingCode !== markingCode);
    if (newItems.length === cart.items.length) return; // nothing matched — no-op
    const totals = calculateTotals(newItems, cart.taxRate, cart.discount);
    const updatedCart = { ...cart, items: newItems, ...totals };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({ tabs: newTabs, items: newItems, ...totals });
  },

  updateQuantity: (productId, quantity, unitPrice?) => {
    const state = get();
    const cart = activeCart(state);
    const rounded = Math.round(quantity * 100) / 100;

    const matches = (i: CartItem) =>
      unitPrice !== undefined
        ? i.productId === productId && i.unitPrice === unitPrice
        : i.productId === productId;

    if (rounded <= 0) {
      const newItems = cart.items.filter((i) => !matches(i));
      const totals = calculateTotals(newItems, cart.taxRate, cart.discount);
      const updatedCart = { ...cart, items: newItems, ...totals };
      const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
      set({ tabs: newTabs, items: newItems, ...totals });
      return;
    }

    const newItems = cart.items.map((i) => {
      if (matches(i)) {
        const newQuantity = Math.min(rounded, i.stock);
        return { ...i, quantity: newQuantity };
      }
      return i;
    });

    const totals = calculateTotals(newItems, cart.taxRate, cart.discount);
    const updatedCart = { ...cart, items: newItems, ...totals };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({ tabs: newTabs, items: newItems, ...totals });
  },

  setDiscount: (discount) => {
    const state = get();
    const cart = activeCart(state);
    const totals = calculateTotals(cart.items, cart.taxRate, discount);
    const updatedCart = { ...cart, discount, ...totals };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({ tabs: newTabs, discount, ...totals });
  },

  setTaxRate: (taxRate) => {
    const state = get();
    const cart = activeCart(state);
    const totals = calculateTotals(cart.items, taxRate, cart.discount);
    const updatedCart = { ...cart, taxRate, ...totals };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({ tabs: newTabs, taxRate, ...totals });
  },

  clearCart: () => {
    const state = get();
    const cleared = emptyTabCart();
    const newTabs = { ...state.tabs, [state.activeTabId]: cleared };
    set({
      tabs: newTabs,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      itemCount: 0,
      editingSaleId: null,
      editingSaleReceipt: null,
    });
  },

  loadSaleForEdit: (saleId, receiptNumber, saleItems) => {
    const state = get();
    const cart = activeCart(state);
    const totals = calculateTotals(saleItems, cart.taxRate, 0);
    const updatedCart: TabCart = {
      ...cart,
      items: saleItems,
      discount: 0,
      editingSaleId: saleId,
      editingSaleReceipt: receiptNumber,
      ...totals,
    };
    const newTabs = { ...state.tabs, [state.activeTabId]: updatedCart };
    set({
      tabs: newTabs,
      items: saleItems,
      discount: 0,
      editingSaleId: saleId,
      editingSaleReceipt: receiptNumber,
      ...totals,
    });
  },
}));

// Selector for tab bar
export function useTabsSelector() {
  return useCartStore((state) => ({
    tabOrder: state.tabOrder,
    activeTabId: state.activeTabId,
    tabs: state.tabs,
    addTab: state.addTab,
    removeTab: state.removeTab,
    setActiveTab: state.setActiveTab,
  }));
}

export function getTabLabel(tabs: Record<string, TabCart>, tabId: string): string {
  const cart = tabs[tabId];
  if (!cart || cart.items.length === 0) return '—';
  return cart.items[0].productName;
}

function calculateTotals(items: CartItem[], taxRate: number, discount: number) {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const tax = subtotal * (taxRate / 100);
  const total = Math.max(0, subtotal + tax - discount);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return { subtotal, tax, total, itemCount };
}
