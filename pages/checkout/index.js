const {
  getCheckoutDraft,
  clearCheckoutDraft,
  getCartDetailed,
  getAddresses,
  getDefaultAddress,
  createOrder,
  saveAddress
} = require("../../utils/store");
const { formatPrice } = require("../../utils/format");

Page({
  data: {
    items: [],
    total: 0,
    totalText: formatPrice(0),
    addresses: [],
    selectedAddressId: "",
    selectedAddress: null,
    note: "",
    loading: false
  },
  async onShow() {
    await this.loadData();
  },
  async loadData() {
    const draft = getCheckoutDraft();
    const items = draft && draft.items && draft.items.length ? draft.items : getCartDetailed();
    if (!items.length) {
      wx.showToast({ title: "请先选择商品", icon: "none" });
      return;
    }
    const total = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const addresses = await getAddresses();
    const selectedAddress = addresses.find((item) => item.isDefault) || addresses[0] || (await getDefaultAddress());
    this.setData({
      items: items.map((item) => ({
        ...item,
        subtotalText: formatPrice(item.subtotal)
      })),
      total,
      totalText: formatPrice(total),
      addresses,
      selectedAddressId: selectedAddress ? selectedAddress.id : "",
      selectedAddress
    });
  },
  selectAddress(e) {
    const { id } = e.currentTarget.dataset;
    const selectedAddress = this.data.addresses.find((item) => item.id === id);
    this.setData({
      selectedAddressId: id,
      selectedAddress
    });
  },
  async chooseWechatAddress() {
    wx.chooseAddress({
      success: async (result) => {
        try {
          const saved = await saveAddress({
            name: result.userName || "",
            mobile: result.telNumber || "",
            province: result.provinceName || "",
            city: result.cityName || "",
            district: result.countyName || "",
            detail: result.detailInfo || "",
            source: "wechat",
            isDefault: true
          });
          await this.loadData();
          this.setData({
            selectedAddressId: saved.id,
            selectedAddress: saved
          });
          wx.showToast({ title: "已导入微信地址", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "导入失败", icon: "none" });
        }
      },
      fail: () => {
        wx.showToast({ title: "未选择地址", icon: "none" });
      }
    });
  },
  goAddressManager() {
    wx.navigateTo({ url: "/pages/address/index" });
  },
  bindNote(e) {
    this.setData({ note: e.detail.value });
  },
  async submitOrder() {
    if (!this.data.selectedAddress) {
      wx.showToast({ title: "请选择收货地址", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      const order = await createOrder({
        items: this.data.items,
        customer: {
          name: this.data.selectedAddress.name,
          source: "wechat-mini-program"
        },
        address: this.data.selectedAddress,
        note: this.data.note
      });
      clearCheckoutDraft();
      wx.navigateTo({ url: `/pages/order-detail/index?id=${order.id}` });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});

