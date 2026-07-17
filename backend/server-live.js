const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ensureDir, readJson, writeJson } = require("./lib/json-store");

const ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(ROOT, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const ADDRESSES_FILE = path.join(DATA_DIR, "addresses.json");
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme";
const WX_APPID = process.env.WX_APPID || "";
const WX_APPSECRET = process.env.WX_APPSECRET || "";

ensureDir(DATA_DIR);

function seedIfMissing(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
  }
}

function ensureSeedFiles() {
  seedIfMissing(PRODUCTS_FILE, require("./data/products.json"));
  seedIfMissing(ORDERS_FILE, []);
  seedIfMissing(USERS_FILE, []);
  seedIfMissing(SESSIONS_FILE, []);
  seedIfMissing(ADDRESSES_FILE, []);
}

function readProducts() {
  return readJson(PRODUCTS_FILE, []);
}
function readOrders() {
  return readJson(ORDERS_FILE, []);
}
function saveOrders(items) {
  writeJson(ORDERS_FILE, items);
}
function readUsers() {
  return readJson(USERS_FILE, []);
}
function saveUsers(items) {
  writeJson(USERS_FILE, items);
}
function readSessions() {
  return readJson(SESSIONS_FILE, []);
}
function saveSessions(items) {
  writeJson(SESSIONS_FILE, items);
}
function readAddresses() {
  return readJson(ADDRESSES_FILE, []);
}
function saveAddresses(items) {
  writeJson(ADDRESSES_FILE, items);
}
function nowIso() {
  return new Date().toISOString();
}
function createId(prefix) {
  return `${prefix}${Date.now()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
function hashCode(code) {
  return crypto.createHash("sha1").update(String(code)).digest("hex").slice(0, 24);
}
function formatMoney(value) {
  return `¥${Number(value).toFixed(2)}`;
}
function statusLabel(code) {
  return {
    pending_payment: "待支付",
    paid: "已支付",
    preparing: "配货中",
    shipping: "发货中",
    done: "已完成",
    cancelled: "已取消"
  }[code] || code || "待支付";
}
function logisticsText(order) {
  const logistics = order.logistics || {};
  if (!logistics.trackingNumber) return "待发货";
  return logistics.statusLabel || `已发货：${logistics.courierName || "快递"} ${logistics.trackingNumber}`;
}
function orderOwner(order) {
  return order.subjectId || order.ownerId || order.clientId || "";
}
function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
function getSubjectId(req, url) {
  const token = getBearerToken(req);
  if (token) {
    const session = readSessions().find((item) => item.token === token);
    if (session) return session.userId;
  }
  return url.searchParams.get("subjectId") || req.headers["x-subject-id"] || url.searchParams.get("clientId") || "";
}
function publicOrder(order) {
  return {
    ...order,
    status: order.status || statusLabel(order.statusCode),
    logisticsText: logisticsText(order),
    amountText: formatMoney(order.amount),
    itemCount: Array.isArray(order.items)
      ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      : 0
  };
}
function setJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Authorization, X-Subject-Id",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}
function setHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(html);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getUser(userId) {
  return readUsers().find((item) => item.userId === userId) || null;
}
function saveUser(userId, profile = {}) {
  const list = readUsers();
  const index = list.findIndex((item) => item.userId === userId);
  const entry = {
    userId,
    profile,
    createdAt: index >= 0 ? list[index].createdAt : nowIso(),
    updatedAt: nowIso()
  };
  if (index >= 0) list[index] = entry; else list.unshift(entry);
  saveUsers(list);
  return entry;
}
function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const list = readSessions();
  list.unshift({ token, userId, createdAt: nowIso() });
  saveSessions(list);
  return token;
}
async function exchangeCode(code) {
  if (!WX_APPID || !WX_APPSECRET) {
    const id = `wx_${hashCode(code)}`;
    return { userId: id, openid: `dev_${hashCode(code)}`, unionid: "" };
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", WX_APPID);
  url.searchParams.set("secret", WX_APPSECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || `WeChat auth failed: ${response.status}`);
  }
  const userId = data.openid || `wx_${hashCode(code)}`;
  return { userId, openid: data.openid || "", unionid: data.unionid || "" };
}
function adminAuth(req) {
  return req.headers["x-admin-token"] === ADMIN_TOKEN;
}

function renderAdminPage() {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>蜜袋鼯主粮店后台</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f4ee;color:#243126}
    .wrap{max-width:1320px;margin:0 auto;padding:24px}
    .top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px}
    h1{margin:0;font-size:28px}
    .muted{color:#6d7a71;font-size:14px}
    .card{background:#fff;border-radius:18px;padding:18px;box-shadow:0 10px 30px rgba(42,67,52,.08);margin-bottom:18px}
    .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
    .stat{background:#f8fbf8;border-radius:16px;padding:14px}
    .stat .label{font-size:13px;color:#6d7a71}
    .stat .value{font-size:28px;font-weight:800;color:#1f5c40}
    .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
    .toolbar>div{min-width:180px}
    label{display:block;margin:0 0 6px;font-weight:600}
    input,select{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dfe5df;border-radius:12px;font:inherit}
    button{padding:10px 14px;border:0;border-radius:999px;background:linear-gradient(135deg,#2f7d57,#6ea54a);color:#fff;font-weight:700;cursor:pointer}
    button.ghost{background:#eef5ef;color:#2f7d57}
    .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .tab{padding:8px 14px;border-radius:999px;background:#eef5ef;color:#2f7d57;cursor:pointer}
    .tab.active{background:linear-gradient(135deg,#2f7d57,#6ea54a);color:#fff}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px 8px;border-bottom:1px solid #edf0eb;text-align:left;vertical-align:top}
    th{color:#617067;font-size:13px;white-space:nowrap}
    .status{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#eef5ef;color:#2f7d57;font-size:12px}
    .detail{font-size:12px;color:#6d7a71;margin-top:6px;line-height:1.6}
    .row-actions{display:flex;gap:8px;flex-wrap:wrap}
    .grid{display:grid;grid-template-columns:1.3fr .9fr;gap:18px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <h1>蜜袋鼯主粮店后台</h1>
        <div class="muted">订单列表、状态流转、人工发货、地址与物流信息查看。</div>
      </div>
      <div class="muted">默认 token: ${ADMIN_TOKEN}</div>
    </div>
    <div class="card stats" id="stats"></div>
    <div class="card">
      <div class="toolbar">
        <div><label>管理员令牌</label><input id="token" value="${ADMIN_TOKEN}" /></div>
        <div><label>搜索</label><input id="keyword" placeholder="订单号 / 用户ID / 运单号" /></div>
        <div><label>状态</label>
          <select id="statusFilter">
            <option value="all">全部</option>
            <option value="pending_payment">待支付</option>
            <option value="paid">已支付</option>
            <option value="preparing">配货中</option>
            <option value="shipping">发货中</option>
            <option value="done">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div><button id="refreshBtn">刷新</button></div>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <h2 style="margin-top:0;">订单列表</h2>
        <table id="ordersTable"></table>
      </div>
      <div class="card">
        <h2 style="margin-top:0;">订单操作</h2>
        <div class="muted">可快速切换状态并补充运单号、物流说明。</div>
        <div class="toolbar" style="margin-top:12px;">
          <div><label>订单ID</label><input id="orderId" placeholder="OD..." /></div>
          <div><label>状态</label>
            <select id="statusCode">
              <option value="preparing">配货中</option>
              <option value="shipping">发货中</option>
              <option value="done">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
          <div><label>快递公司</label><input id="courierName" placeholder="顺丰" value="顺丰" /></div>
          <div><label>运单号</label><input id="trackingNumber" placeholder="SF1234567890" /></div>
          <div style="flex:1;"><label>物流说明</label><input id="statusLabel" placeholder="已发货，等待揽收" /></div>
          <div><button id="saveBtn">保存</button></div>
        </div>
        <div id="detail" class="detail"></div>
      </div>
    </div>
  </div>
  <script>
    const tokenInput = document.getElementById("token");
    const keywordInput = document.getElementById("keyword");
    const statusFilterInput = document.getElementById("statusFilter");
    const orderIdInput = document.getElementById("orderId");
    const courierNameInput = document.getElementById("courierName");
    const trackingNumberInput = document.getElementById("trackingNumber");
    const statusCodeInput = document.getElementById("statusCode");
    const statusLabelInput = document.getElementById("statusLabel");
    const ordersTable = document.getElementById("ordersTable");
    const detail = document.getElementById("detail");
    let orders = [];

    async function api(path, options = {}) {
      const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
      if (tokenInput.value) headers["X-Admin-Token"] = tokenInput.value;
      const response = await fetch(path, { ...options, headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "请求失败");
      return data;
    }

    function filteredOrders() {
      const keyword = keywordInput.value.trim().toLowerCase();
      const status = statusFilterInput.value;
      return orders.filter((order) => {
        const statusOk = status === "all" ? true : order.statusCode === status;
        if (!statusOk) return false;
        if (!keyword) return true;
        return [order.id, order.subjectId, order.ownerType, order.logistics && order.logistics.trackingNumber, order.logisticsText, order.customer && order.customer.name].join(" ").toLowerCase().includes(keyword);
      });
    }

    function renderStats() {
      const stats = { total: orders.length, pending_payment: 0, paid: 0, preparing: 0, shipping: 0, done: 0 };
      orders.forEach((order) => {
        if (stats[order.statusCode] !== undefined) stats[order.statusCode] += 1;
      });
      document.getElementById("stats").innerHTML = [
        ["总订单", stats.total],
        ["待支付", stats.pending_payment],
        ["已支付", stats.paid],
        ["配货中", stats.preparing],
        ["发货中", stats.shipping],
        ["已完成", stats.done]
      ].map(([label, value]) => '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>').join("");
    }

    function fillForm(order) {
      orderIdInput.value = order.id;
      courierNameInput.value = order.logistics && order.logistics.courierName ? order.logistics.courierName : "顺丰";
      trackingNumberInput.value = order.logistics && order.logistics.trackingNumber ? order.logistics.trackingNumber : "";
      statusCodeInput.value = order.statusCode === "pending_payment" ? "preparing" : order.statusCode;
      statusLabelInput.value = order.logistics && order.logistics.statusLabel ? order.logistics.statusLabel : "";
      detail.innerHTML = '<div><b>订单：</b>' + order.id + '</div>' +
        '<div><b>用户：</b>' + (order.subjectId || "") + '</div>' +
        '<div><b>状态：</b>' + order.status + '</div>' +
        '<div><b>地址：</b>' + (order.addressSnapshot ? (order.addressSnapshot.name + " " + order.addressSnapshot.mobile + " " + order.addressSnapshot.province + order.addressSnapshot.city + order.addressSnapshot.district + order.addressSnapshot.detail) : "未填写") + '</div>' +
        '<div><b>物流：</b>' + (order.logisticsText || "") + '</div>';
    }

    function renderTable() {
      const list = filteredOrders();
      ordersTable.innerHTML = [
        "<tr><th>订单</th><th>状态</th><th>用户</th><th>金额</th><th>地址</th><th>操作</th></tr>",
        ...list.map((order) => {
          const address = order.addressSnapshot ? order.addressSnapshot.name + " " + order.addressSnapshot.mobile : "未填写";
          const addressDetail = order.addressSnapshot ? order.addressSnapshot.province + order.addressSnapshot.city + order.addressSnapshot.district + order.addressSnapshot.detail : "";
          return '<tr>' +
            '<td>' + order.id + '<div class="detail">' + new Date(order.createdAt).toLocaleString() + '</div></td>' +
            '<td><span class="status">' + order.status + '</span><div class="detail">' + order.statusCode + '</div></td>' +
            '<td>' + (order.subjectId || "") + '<div class="detail">' + (order.ownerType || "") + '</div></td>' +
            '<td>' + (order.amountText || "¥0.00") + '</td>' +
            '<td>' + address + '<div class="detail">' + addressDetail + '</div></td>' +
            '<td><div class="row-actions">' +
            '<button class="ghost" data-id="' + order.id + '" data-action="select">选中</button>' +
            '<button class="ghost" data-id="' + order.id + '" data-action="preparing">配货</button>' +
            '<button class="ghost" data-id="' + order.id + '" data-action="shipping">发货</button>' +
            '<button class="ghost" data-id="' + order.id + '" data-action="done">完成</button>' +
            '</div></td>' +
            '</tr>';
        })
      ].join("");
      ordersTable.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const order = orders.find((item) => item.id === btn.dataset.id);
          if (!order) return;
          if (btn.dataset.action === "select") {
            fillForm(order);
            return;
          }
          await updateOrder(order.id, {
            statusCode: btn.dataset.action,
            courierName: btn.dataset.action === "shipping" ? ((order.logistics && order.logistics.courierName) || "顺丰") : ((order.logistics && order.logistics.courierName) || ""),
            trackingNumber: (order.logistics && order.logistics.trackingNumber) || "",
            statusLabel: btn.dataset.action === "preparing" ? "正在配货" : btn.dataset.action === "shipping" ? "已发货，等待揽收" : btn.dataset.action === "done" ? "订单已完成" : "已取消"
          });
        });
      });
    }

    async function updateOrder(orderId, body) {
      await api("/api/admin/orders/" + encodeURIComponent(orderId), {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      await loadOrders();
    }

    async function loadOrders() {
      const response = await api("/api/admin/orders");
      orders = response.data || [];
      renderStats();
      renderTable();
    }

    document.getElementById("refreshBtn").addEventListener("click", () => loadOrders().catch((error) => alert(error.message)));
    document.getElementById("saveBtn").addEventListener("click", async () => {
      try {
        await updateOrder(orderIdInput.value, {
          statusCode: statusCodeInput.value,
          courierName: courierNameInput.value,
          trackingNumber: trackingNumberInput.value,
          statusLabel: statusLabelInput.value
        });
        alert("保存成功");
      } catch (error) {
        alert(error.message);
      }
    });
    keywordInput.addEventListener("input", renderTable);
    statusFilterInput.addEventListener("change", renderTable);
    loadOrders().catch((error) => {
      document.body.insertAdjacentHTML("beforeend", "<pre style='padding:24px;color:#b00020;'>" + error.message + "</pre>");
    });
  </script>
</body>
</html>`;
  return html;
}

async function handleAuthLogin(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.code) return setJson(res, 400, { message: "code is required" });
    const identity = await exchangeCode(body.code);
    const token = createSession(identity.userId);
    const user = saveUser(identity.userId, body.profile || {});
    return setJson(res, 200, {
      data: {
        token,
        userId: identity.userId,
        openid: identity.openid || "",
        unionid: identity.unionid || "",
        profile: user.profile || {}
      }
    });
  } catch (error) {
    return setJson(res, 500, { message: error.message || "login failed" });
  }
}

function handleAuthMe(req, res) {
  const token = getBearerToken(req);
  const session = readSessions().find((item) => item.token === token);
  if (!session) return setJson(res, 401, { message: "unauthorized" });
  const user = getUser(session.userId);
  return setJson(res, 200, { data: { token, userId: session.userId, profile: (user && user.profile) || {} } });
}

function handleProducts(req, res) {
  return setJson(res, 200, { data: readProducts() });
}

function handleAddressesList(req, res, url) {
  const subjectId = getSubjectId(req, url);
  return setJson(res, 200, { data: readAddresses().filter((item) => item.subjectId === subjectId) });
}

async function handleAddressesCreate(req, res) {
  const body = await parseBody(req);
  if (!body.subjectId) return setJson(res, 400, { message: "subjectId is required" });
  const list = readAddresses();
  const sameSubject = list.filter((item) => item.subjectId === body.subjectId);
  const address = {
    id: createId("ADDR_"),
    subjectId: body.subjectId,
    name: body.name || "",
    mobile: body.mobile || "",
    province: body.province || "",
    city: body.city || "",
    district: body.district || "",
    detail: body.detail || "",
    isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : sameSubject.length === 0,
    source: body.source || "manual",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (address.isDefault) {
    sameSubject.forEach((item) => (item.isDefault = false));
  }
  list.push(address);
  saveAddresses(list);
  return setJson(res, 201, { data: address });
}

async function handleAddressesPatch(req, res, id) {
  const body = await parseBody(req);
  const list = readAddresses();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return setJson(res, 404, { message: "address not found" });
  const subjectId = list[index].subjectId;
  const next = { ...list[index], ...body, updatedAt: nowIso() };
  if (next.isDefault) {
    list.forEach((item) => {
      if (item.subjectId === subjectId) item.isDefault = false;
    });
  }
  list[index] = next;
  saveAddresses(list);
  return setJson(res, 200, { data: next });
}

function handleAddressesDelete(req, res, id) {
  const next = readAddresses().filter((item) => item.id !== id);
  saveAddresses(next);
  return setJson(res, 200, { data: { ok: true } });
}

function handleAddressDefault(req, res, id) {
  const list = readAddresses();
  const current = list.find((item) => item.id === id);
  if (!current) return setJson(res, 404, { message: "address not found" });
  const next = list.map((item) => ({
    ...item,
    isDefault: item.subjectId === current.subjectId && item.id === id
  }));
  saveAddresses(next);
  return setJson(res, 200, { data: next.find((item) => item.id === id) });
}

function handleOrdersList(req, res, url) {
  const subjectId = getSubjectId(req, url);
  const list = readOrders().filter((order) => !subjectId || orderOwner(order) === subjectId).map(publicOrder);
  return setJson(res, 200, { data: list });
}

async function handleOrdersCreate(req, res) {
  const body = await parseBody(req);
  const subjectId = body.subjectId || getSubjectId(req, new URL(req.url, `http://${req.headers.host}`));
  if (!subjectId) return setJson(res, 400, { message: "subjectId is required" });
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return setJson(res, 400, { message: "items are required" });
  const normalized = items.map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    quantity: Number(item.quantity || 1),
    subtotal: Number((Number(item.price) * Number(item.quantity || 1)).toFixed(2)),
    spec: item.spec || ""
  }));
  const addressSnapshot = body.addressSnapshot || null;
  const order = {
    id: createId("OD"),
    subjectId,
    ownerType: body.ownerType || "guest",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    paidAt: "",
    statusCode: "pending_payment",
    status: statusLabel("pending_payment"),
    items: normalized,
    amount: Number(normalized.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)),
    customer: body.customer || {},
    addressId: body.addressId || (addressSnapshot && addressSnapshot.id) || "",
    addressSnapshot,
    logistics: {
      courierName: "",
      trackingNumber: "",
      statusLabel: "待发货",
      updatedAt: nowIso()
    },
    note: body.note || "",
    source: body.source || "miniprogram"
  };
  const list = readOrders();
  list.unshift(order);
  saveOrders(list);
  return setJson(res, 201, { data: publicOrder(order) });
}

function handleOrderDetail(req, res, url, id) {
  const subjectId = getSubjectId(req, url);
  const order = readOrders().find((item) => item.id === id);
  if (!order) return setJson(res, 404, { message: "order not found" });
  if (subjectId && orderOwner(order) !== subjectId) return setJson(res, 403, { message: "forbidden" });
  return setJson(res, 200, { data: publicOrder(order) });
}

function handleOrderPay(req, res, id) {
  const list = readOrders();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return setJson(res, 404, { message: "order not found" });
  if (list[index].statusCode !== "pending_payment") return setJson(res, 400, { message: "order is not pending payment" });
  list[index] = { ...list[index], paidAt: nowIso(), updatedAt: nowIso(), statusCode: "paid", status: statusLabel("paid") };
  saveOrders(list);
  return setJson(res, 200, { data: publicOrder(list[index]) });
}

async function handleAdminOrderPatch(req, res, id) {
  if (!adminAuth(req)) return setJson(res, 401, { message: "unauthorized" });
  const body = await parseBody(req);
  const list = readOrders();
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return setJson(res, 404, { message: "order not found" });
  const current = list[index];
  const nextStatus = body.statusCode || current.statusCode;
  list[index] = {
    ...current,
    updatedAt: nowIso(),
    statusCode: nextStatus,
    status: statusLabel(nextStatus),
    logistics: {
      courierName: body.courierName !== undefined ? body.courierName : (current.logistics && current.logistics.courierName) || "",
      trackingNumber: body.trackingNumber !== undefined ? body.trackingNumber : (current.logistics && current.logistics.trackingNumber) || "",
      statusLabel:
        body.statusLabel !== undefined
          ? body.statusLabel
          : nextStatus === "preparing"
          ? "正在配货"
          : nextStatus === "shipping"
          ? "已发货，等待揽收"
          : nextStatus === "done"
          ? "订单已完成"
          : nextStatus === "cancelled"
          ? "订单已取消"
          : (current.logistics && current.logistics.statusLabel) || "待发货",
      updatedAt: nowIso()
    }
  };
  saveOrders(list);
  return setJson(res, 200, { data: publicOrder(list[index]) });
}

function handleAdminOrders(req, res) {
  if (!adminAuth(req)) return setJson(res, 401, { message: "unauthorized" });
  return setJson(res, 200, { data: readOrders().map(publicOrder) });
}

function handleOptions(req, res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Authorization, X-Subject-Id",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  res.end();
}

ensureSeedFiles();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "OPTIONS") return handleOptions(req, res);
    if (url.pathname === "/") return setJson(res, 200, { message: "Honey glider store backend is running" });
    if (url.pathname === "/admin") return setHtml(res, renderAdminPage());
    if (url.pathname === "/api/health") return setJson(res, 200, { ok: true });
    if (url.pathname === "/api/products" && req.method === "GET") return handleProducts(req, res);
    if (url.pathname === "/api/auth/login" && req.method === "POST") return handleAuthLogin(req, res);
    if (url.pathname === "/api/auth/me" && req.method === "GET") return handleAuthMe(req, res);
    if (url.pathname === "/api/addresses" && req.method === "GET") return handleAddressesList(req, res, url);
    if (url.pathname === "/api/addresses" && req.method === "POST") return handleAddressesCreate(req, res);
    if (url.pathname.startsWith("/api/addresses/") && url.pathname.endsWith("/default") && req.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      return handleAddressDefault(req, res, id);
    }
    if (url.pathname.startsWith("/api/addresses/") && req.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      return handleAddressesPatch(req, res, id);
    }
    if (url.pathname.startsWith("/api/addresses/") && req.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      return handleAddressesDelete(req, res, id);
    }
    if (url.pathname === "/api/orders" && req.method === "GET") return handleOrdersList(req, res, url);
    if (url.pathname === "/api/orders" && req.method === "POST") return handleOrdersCreate(req, res);
    if (url.pathname.startsWith("/api/orders/") && url.pathname.endsWith("/pay") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      return handleOrderPay(req, res, id);
    }
    if (url.pathname.startsWith("/api/orders/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/")[3]);
      return handleOrderDetail(req, res, url, id);
    }
    if (url.pathname === "/api/admin/orders" && req.method === "GET") return handleAdminOrders(req, res);
    if (url.pathname.startsWith("/api/admin/orders/") && req.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/")[4] || "");
      return handleAdminOrderPatch(req, res, id);
    }
    return setJson(res, 404, { message: "not found" });
  } catch (error) {
    return setJson(res, 500, { message: error.message || "internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Backend running at http://127.0.0.1:${PORT}`);
  console.log(`Admin page: http://127.0.0.1:${PORT}/admin`);
});
