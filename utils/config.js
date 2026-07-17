const API_BASE_URL_KEY = "sg_api_base_url";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";

function getApiBaseUrl() {
  try {
    const value = wx.getStorageSync(API_BASE_URL_KEY);
    return value || DEFAULT_API_BASE_URL;
  } catch (error) {
    return DEFAULT_API_BASE_URL;
  }
}

function setApiBaseUrl(value) {
  wx.setStorageSync(API_BASE_URL_KEY, value);
}

module.exports = {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  setApiBaseUrl
};

