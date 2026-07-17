const { getCartDetailed, updateCartItem, setCheckoutDraft } = require("../../utils/store");
const { formatPrice } = require("../../utils/format");

Page({
  data: {
    items: [],
    total: 0,
    totalText: formatPrice(0)
  },
  onShow() {
    this.loadData();
  },
  loadData() {
    const items = getCartDetailed().map((item) => ({
      ...item,
      priceText: formatPrice(item.price),
      subtotalText: formatPrice(item.subtotal)
    }));
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    this.setData({
      items,
      total,
      totalText: formatPrice(total)
    });
  },
  increase(e) {
    const { id, quantity } = e.currentTarget.dataset;
    updateCartItem(id, quantity + 1);
    this.loadData();
  },
  decrease(e) {
    const { id, quantity } = e.currentTarget.dataset;
    updateCartItem(id, quantity - 1);
    this.loadData();
  },
  remove(e) {
    const { id } = e.currentTarget.dataset;
    updateCartItem(id, 0);
    this.loadData();
  },
  checkout() {
    if (!this.data.items.length) {
      wx.showToast({ title: "购物车为空", icon: "none" });
      return;
    }
    setCheckoutDraft(this.data.items, { source: "cart" });
    wx.navigateTo({ url: "/pages/checkout/index" });
  }
});

