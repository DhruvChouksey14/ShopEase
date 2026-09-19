import { create } from 'zustand';
import { cartApi } from '../api/cart.api';

export const useCartStore = create((set, get) => ({
  items: [],
  subtotal: 0,
  isLoading: false,

  fetchCart: async () => {
    set({ isLoading: true });
    try {
      const res = await cartApi.getCart();
      const data = res.data || res;
      set({ items: data.items || [], subtotal: data.subtotal || 0, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addItem: async (productId, quantity = 1) => {
    const res = await cartApi.addItem(productId, quantity);
    const data = res.data || res;
    set({ items: data.items || [], subtotal: data.subtotal || 0 });
  },

  updateItem: async (productId, quantity) => {
    const res = await cartApi.updateItem(productId, quantity);
    const data = res.data || res;
    set({ items: data.items || [], subtotal: data.subtotal || 0 });
  },

  removeItem: async (productId) => {
    const res = await cartApi.removeItem(productId);
    const data = res.data || res;
    set({ items: data.items || [], subtotal: data.subtotal || 0 });
  },

  clearLocal: () => set({ items: [], subtotal: 0 }),

  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));
