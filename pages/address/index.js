const { getAddresses, saveAddress, deleteAddress, setDefaultAddress } = require("../../utils/store");

Page({
  data: {
    addresses: [],
    form: {
      id: "",
      name: "",
      mobile: "",
      province: "",
      city: "",
      district: "",
      detail: "",
      isDefault: false,
      source: "manual"
    },
    saving: false
  },
  onShow() {
    this.loadData();
  },
  async loadData() {
    const addresses = await getAddresses();
    this.setData({ addresses });
  },
  pickWechatAddress() {
    wx.chooseAddress({
      success: (result) => {
        this.setData({
          form: {
            ...this.data.form,
            name: result.userName || "",
            mobile: result.telNumber || "",
            province: result.provinceName || "",
            city: result.cityName || "",
            district: result.countyName || "",
            detail: result.detailInfo || "",
            source: "wechat",
            isDefault: true
          }
        });
      },
      fail: () => {
        wx.showToast({ title: "未选择微信地址", icon: "none" });
      }
    });
  },
  bindField(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({
      form: {
        ...this.data.form,
        [field]: e.detail.value
      }
    });
  },
  toggleDefault(e) {
    this.setData({
      form: {
        ...this.data.form,
        isDefault: e.detail.value.length > 0
      }
    });
  },
  editAddress(e) {
    const { id } = e.currentTarget.dataset;
    const address = this.data.addresses.find((item) => item.id === id);
    if (!address) return;
    this.setData({
      form: {
        ...address,
        source: address.source || "manual"
      }
    });
  },
  newAddress() {
    this.setData({
      form: {
        id: "",
        name: "",
        mobile: "",
        province: "",
        city: "",
        district: "",
        detail: "",
        isDefault: false,
        source: "manual"
      }
    });
  },
  async saveForm() {
    const { form } = this.data;
    if (!form.name || !form.mobile || !form.detail) {
      wx.showToast({ title: "请完善收货信息", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      await saveAddress(form);
      await this.loadData();
      this.newAddress();
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
  async makeDefault(e) {
    const { id } = e.currentTarget.dataset;
    await setDefaultAddress(id);
    await this.loadData();
  },
  async removeAddress(e) {
    const { id } = e.currentTarget.dataset;
    await deleteAddress(id);
    await this.loadData();
    wx.showToast({ title: "已删除", icon: "success" });
  }
});

