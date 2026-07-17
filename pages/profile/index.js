const { getDashboard, defaultProfile } = require("../../utils/store");
const { getSession, isLoggedIn, loginWithCode, clearSession } = require("../../utils/session");

Page({
  data: {
    profile: defaultProfile,
    dashboard: {},
    session: null,
    loggedIn: false,
    loggingIn: false,
    subjectIdText: "guest"
  },
  onShow() {
    this.loadData();
  },
  async loadData() {
    const [dashboard, session] = await Promise.all([getDashboard(), Promise.resolve(getSession())]);
    this.setData({
      dashboard,
      session,
      loggedIn: isLoggedIn(),
      profile: session && session.profile ? { ...defaultProfile, ...session.profile } : defaultProfile,
      subjectIdText: session && session.userId ? session.userId : "guest"
    });
  },
  async login() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });
    try {
      await loginWithCode({ nickname: "微信用户" });
      await this.loadData();
      wx.showToast({ title: "登录成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "登录失败", icon: "none" });
    } finally {
      this.setData({ loggingIn: false });
    }
  },
  logout() {
    clearSession();
    this.loadData();
    wx.showToast({ title: "已退出", icon: "success" });
  },
  goAddress() {
    wx.navigateTo({ url: "/pages/address/index" });
  }
});

