const { getOrders } = require("../../utils/store");
const { formatPrice, formatDate } = require("../../utils/format");

Page({
  data: {
    orders: [],
    visibleOrders: [],
    currentTab: "all",
    tabs: [
      { key: "all", label: "全部" },
      { key: "pending_payment", label: "待支付" },
      { key: "paid", label: "已支付" },
      { key: "preparing", label: "配货中" },
      { key: "shipping", label: "发货中" },
      { key: "done", label: "已完成" }
    ]
  },
  onShow() {
    this.loadData();
  },
  async loadData() {
    const orders = await getOrders();
    const decorated = orders.map((item) => ({
      ...item,
      amountText: formatPrice(item.amount),
      createdAtText: formatDate(item.createdAt)
    }));
    this.setData({
      orders: decorated,
      visibleOrders: this.getVisibleOrders(decorated, this.data.currentTab)
    });
  },
  switchTab(e) {
    const currentTab = e.currentTarget.dataset.key;
    this.setData({
      currentTab,
      visibleOrders: this.getVisibleOrders(this.data.orders, currentTab)
    });
  },
  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
  },
  getVisibleOrders(orders, currentTab) {
    return currentTab === "all" ? orders : orders.filter((item) => item.statusCode === currentTab);
  }
});

