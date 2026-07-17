const { DEFAULT_API_BASE_URL, getApiBaseUrl } = require("./config");

const SESSION_KEY = "sg_session";
const GUEST_KEY = "sg_guest_id";

function readStorage(key, fallback = null) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  wx.setStorageSync(key, value);
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getGuestId() {
  let guestId = readStorage(GUEST_KEY, "");
  if (!guestId) {
    guestId = randomId("guest");
    writeStorage(GUEST_KEY, guestId);
  }
  return guestId;
}

function getSession() {
  return readStorage(SESSION_KEY, null);
}

function saveSession(session) {
  writeStorage(SESSION_KEY, session);
}

function clearSession() {
  try {
    wx.removeStorageSync(SESSION_KEY);
  } catch (error) {
    writeStorage(SESSION_KEY, null);
  }
}

function isLoggedIn() {
  const session = getSession();
  return Boolean(session && session.token && session.userId);
}

function getSubjectId() {
  const session = getSession();
  return session && session.userId ? session.userId : getGuestId();
}

function getAuthHeaders() {
  const headers = {
    "X-Subject-Id": getSubjectId()
  };
  const session = getSession();
  if (session && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

function requestJson(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBaseUrl()}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        "Content-Type": "application/json",
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

async function loginWithCode(profile = {}) {
  const loginResult = await new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject
    });
  });

  if (!loginResult || !loginResult.code) {
    throw new Error("wx.login failed");
  }

  const response = await requestJson("/api/auth/login", {
    method: "POST",
    data: {
      code: loginResult.code,
      profile: {
        nickname: profile.nickname || "微信用户",
        avatarUrl: profile.avatarUrl || "",
        source: "miniprogram"
      }
    }
  });

  saveSession(response.data);
  return response.data;
}

async function fetchCurrentUser() {
  const session = getSession();
  if (!session || !session.token) return null;
  try {
    const response = await requestJson("/api/auth/me", {
      header: getAuthHeaders()
    });
    if (response && response.data) {
      saveSession({
        ...session,
        ...response.data
      });
      return response.data;
    }
  } catch (error) {
    return null;
  }
  return null;
}

module.exports = {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  getGuestId,
  getSession,
  saveSession,
  clearSession,
  isLoggedIn,
  getSubjectId,
  getAuthHeaders,
  requestJson,
  loginWithCode,
  fetchCurrentUser
};

