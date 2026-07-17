const { getApiBaseUrl, getAuthHeaders } = require("./session");

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBaseUrl()}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
        ...(options.header || {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error((res.data && res.data.message) || `HTTP ${res.statusCode}`));
        }
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  request
};

