const { getOrderById, payOrder } = require("../../utils/store");
const { formatPrice, formatDate } = require("../../utils/format");

Page({
  data: {
    order: null,
    loading: false
  },
  onLoad(options) {
    this.loadData(options.id);
  },
  onShow() {
    if (this.data.order) {
      this.loadData(this.data.order.id);
    }
  },
  async loadData(id) {
    this.setData({ loading: true });
    const order = await getOrderById(id);
    this.setData({
      order: this.decorateOrder(order),
      loading: false
    });
  },
  async refresh() {
    if (!this.data.order) return;
    await this.loadData(this.data.order.id);
    wx.showToast({ title: "已刷新", icon: "success" });
  },
  async payNow() {
    if (!this.data.order) return;
    try {
      await payOrder(this.data.order.id);
      await this.loadData(this.data.order.id);
      wx.showToast({ title: "支付成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "支付失败", icon: "none" });
    }
  },
  decorateOrder(order) {
    if (!order) return null;
    const address = order.addressSnapshot || {};
    return {
      ...order,
      amountText: formatPrice(order.amount),
      createdAtText: formatDate(order.createdAt),
      paymentText: order.statusCode === "pending_payment" ? "待支付" : "已支付",
      logisticsText: order.logisticsText || (order.logistics && order.logistics.statusLabel) || "待发货",
      trackingText: order.logistics && order.logistics.trackingNumber
        ? `${order.logistics.courierName || "快递"} ${order.logistics.trackingNumber}`
        : "暂无运单号",
      addressText: address.id
        ? `${address.name} ${address.mobile} ${address.province}${address.city}${address.district}${address.detail}`
        : "未选择收货地址",
      items: order.items.map((item) => ({
        ...item,
        subtotalText: formatPrice(item.subtotal)
      }))
    };
  }
});

