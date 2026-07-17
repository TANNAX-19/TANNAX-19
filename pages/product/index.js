const { getProductById, addToCart, setCheckoutDraft } = require("../../utils/store");
const { formatPrice } = require("../../utils/format");

Page({
  data: {
    product: null,
    quantity: 1
  },
  async onLoad(options) {
    const product = await getProductById(options.id);
    this.setData({
      quantity: 1,
      product: this.decorateProduct(product, 1)
    });
  },
  increase() {
    const quantity = this.data.quantity + 1;
    this.setData({
      quantity,
      product: this.decorateProduct(this.data.product, quantity)
    });
  },
  decrease() {
    if (this.data.quantity <= 1) return;
    const quantity = this.data.quantity - 1;
    this.setData({
      quantity,
      product: this.decorateProduct(this.data.product, quantity)
    });
  },
  addCart() {
    addToCart(this.data.product.id, this.data.quantity);
    wx.showToast({ title: "已加入购物车", icon: "success" });
  },
  async buyNow() {
    const item = {
      ...this.data.product,
      quantity: this.data.quantity,
      subtotal: this.data.product.price * this.data.quantity
    };
    setCheckoutDraft([item], { source: "product" });
    wx.navigateTo({ url: "/pages/checkout/index" });
  },
  decorateProduct(product, quantity) {
    if (!product) return null;
    return {
      ...product,
      priceText: formatPrice(product.price),
      originalPriceText: formatPrice(product.originalPrice),
      totalText: formatPrice(product.price * quantity)
    };
  }
});

