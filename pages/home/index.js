const { getProducts, getDashboard } = require("../../utils/store");
const { formatPrice } = require("../../utils/format");

Page({
  data: {
    products: [],
    dashboard: {}
  },
  onShow() {
    this.loadData();
  },
  async loadData() {
    const [products, dashboard] = await Promise.all([
      getProducts(),
      getDashboard()
    ]);
    this.setData({
      products: products.map((item) => ({
        ...item,
        priceText: formatPrice(item.price),
        originalPriceText: formatPrice(item.originalPrice)
      })),
      dashboard
    });
  },
  goProduct(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/product/index?id=${id}` });
  }
});

