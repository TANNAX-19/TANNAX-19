const CLIENT_ID_KEY = "sg_client_id";

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function getClientId() {
  try {
    const existing = wx.getStorageSync(CLIENT_ID_KEY);
    if (existing) return existing;
    const value = `client_${Date.now()}_${randomSuffix()}`;
    wx.setStorageSync(CLIENT_ID_KEY, value);
    return value;
  } catch (error) {
    return `client_${Date.now()}_${randomSuffix()}`;
  }
}

module.exports = {
  getClientId
};

