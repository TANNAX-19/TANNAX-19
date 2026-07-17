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
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "changeme";
const APPID = process.env.WX_APPID || "";
const APPSECRET = process.env.WX_APPSECRET || "";

ensureDir(DATA_DIR);

function ensureJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
  }
}

function ensureSeedFiles() {
  ensureJsonFile(PRODUCTS_FILE, require("./data/products.json"));
  ensureJsonFile(ORDERS_FILE, []);
  ensureJsonFile(USERS_FILE, []);
  ensureJsonFile(SESSIONS_FILE, []);
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Authorization, X-Subject-Id",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
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

function readProducts() {
  return readJson(PRODUCTS_FILE, []);
}

function readOrders() {
  return readJson(ORDERS_FILE, []);
}

function saveOrders(orders) {
  writeJson(ORDERS_FILE, orders);
}

function readUsers() {
  return readJson(USERS_FILE, []);
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function readSessions() {
  return readJson(SESSIONS_FILE, []);
}

function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function formatMoney(value) {
  return `¥${Number(value).toFixed(2)}`;
}

function createOrderId() {
  return `OD${Date.now()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashSubject(code) {
  return crypto.createHash("sha1").update(String(code)).digest("hex").slice(0, 24);
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

function findSession(token) {
  const sessions = readSessions();
  return sessions.find((item) => item.token === token) || null;
}

function getRequestSubject(req, url) {
  const bearer = getBearerToken(req);
  if (bearer) {
    const session = findSession(bearer);
    if (session) {
      return session.userId;
    }
  }
  return url.searchParams.get("subjectId") || req.headers["x-subject-id"] || url.searchParams.get("clientId") || "";
}

function orderOwnerId(order) {
  return order.subjectId || order.ownerId || order.clientId || "";
}

function createLogisticsText(order) {
  const logistics = order.logistics || {};
  if (!logistics.trackingNumber) return "待发货";
  return logistics.statusLabel || `已发货：${logistics.courierName || "快递"} ${logistics.trackingNumber}`;
}

function publicOrderView(order) {
  return {
    ...order,
    logisticsText: createLogisticsText(order),
    amountText: formatMoney(order.amount),
    itemCount: Array.isArray(order.items)
      ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
      : 0
  };
}

function getUserById(userId) {
  return readUsers().find((item) => item.userId === userId) || null;
}

function saveUserProfile(user) {
  const users = readUsers();
  const index = users.findIndex((item) => item.userId === user.userId);
  if (index >= 0) {
    users[index] = { ...users[index], ...user, updatedAt: new Date().toISOString() };
  } else {
    users.unshift({ ...user, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  saveUsers(users);
}

function saveSession(userId, profile = {}) {
  const sessions = readSessions();
  const token = createToken();
  sessions.unshift({
    token,
    userId,
    createdAt: new Date().toISOString()
  });
  saveSessions(sessions);
  saveUserProfile({ userId, profile });
  return token;
}

async function exchangeCodeForSession(code) {
  if (!APPID || !APPSECRET) {
    return {
      userId: `wx_${hashSubject(code)}`,
      openid: `dev_${hashSubject(code)}`,
      unionid: ""
    };
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", APPID);
  url.searchParams.set("secret", APPSECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || `WeChat auth failed: ${data.errcode || response.status}`);
  }
  return {
    userId: data.openid || `wx_${hashSubject(code)}`,
    openid: data.openid || "",
    unionid: data.unionid || ""
  };
}

function adminAuth(req) {
  return req.headers["x-admin-token"] === ADMIN_TOKEN;
}

function renderAdminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>蜜袋鼯主粮店后台</title>
  <style>
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f7f4ee; color:#243126; }
    .wrap { max-width:1200px; margin:0 auto; padding:24px; }
    .card { background:#fff; border-radius:18px; padding:18px; box-shadow:0 10px 30px rgba(42,67,52,.08); margin-bottom:18px; }
    h1 { margin:0 0 12px; font-size:28px; }
    .muted { color:#6d7a71; font-size:14px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    label { display:block; margin:10px 0 6px; font-weight:600; }
    input, select { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #dfe5df; border-radius:12px; font:inherit; background:#fff; }
    button { padding:10px 16px; border:0; border-radius:999px; background:linear-gradient(135deg,#2f7d57,#6ea54a); color:#fff; font-weight:600; cursor:pointer; }
    table { width:100%; border-collapse:collapse; }
    th, td { padding:10px 8px; border-bottom:1px solid #edf0eb; text-align:left; vertical-align:top; }
    th { color:#617067; font-size:13px; }
    .status { display:inline-block; padding:6px 10px; border-radius:999px; background:#eef5ef; color:#2f7d57; font-size:12px; }
    .toolbar { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; }
    .toolbar > div { min-width:180px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>蜜袋鼯主粮店后台</h1>
    <div class="muted">人工发货、填写运单号、同步物流状态。默认管理员令牌可通过环境变量 ADMIN_TOKEN 设置。</div>
    <div class="card">
      <div class="toolbar">
        <div><label>管理员令牌</label><input id="token" value="${ADMIN_TOKEN}" /></div>
        <div><label>订单ID</label><input id="orderId" placeholder="OD..." /></div>
        <div><label>快递公司</label><input id="courierName" placeholder="顺丰" value="顺丰" /></div>
        <div><label>运单号</label><input id="trackingNumber" placeholder="SF1234567890" /></div>
        <div><label>状态</label>
          <select id="statusCode">
            <option value="shipping">发货中</option>
            <option value="done">已完成</option>
          </select>
        </div>
        <div style="flex:1"><label>物流说明</label><input id="statusLabel" placeholder="已发货，等待揽收" /></div>
        <div><button id="saveBtn">保存发货信息</button></div>
      </div>
      <div class="muted" style="margin-top:10px;">保存后，小程序订单详情页刷新即可看到最新物流信息。</div>
    </div>
    <div class="grid">
      <div class="card">
        <h2 style="margin-top:0;">商品列表</h2>
        <table id="productsTable"></table>
      </div>
      <div class="card">
        <h2 style="margin-top:0;">订单列表</h2>
        <table id="ordersTable"></table>
      </div>
    </div>
  </div>
  <script>
    const tokenInput = document.getElementById('token');
    const orderIdInput = document.getElementById('orderId');
    const courierNameInput = document.getElementById('courierName');
    const trackingNumberInput = document.getElementById('trackingNumber');
    const statusCodeInput = document.getElementById('statusCode');
    const statusLabelInput = document.getElementById('statusLabel');

    async function api(path, options = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      if (tokenInput.value) headers['X-Admin-Token'] = tokenInput.value;
      const response = await fetch(path, { ...options, headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '请求失败');
      return data;
    }

    async function loadTables() {
      const [products, orders] = await Promise.all([
        api('/api/products'),
        api('/api/admin/orders')
      ]);
      document.getElementById('productsTable').innerHTML =
        '<tr><th>ID</th><th>名称</th><th>价格</th><th>标签</th></tr>' +
        products.data.map(p => \`<tr><td>\${p.id}</td><td>\${p.name}</td><td>¥\${p.price}</td><td>\${(p.tags || []).join('、')}</td></tr>\`).join('');
      document.getElementById('ordersTable').innerHTML =
        '<tr><th>订单</th><th>状态</th><th>金额</th><th>物流</th></tr>' +
        orders.data.map(o => \`<tr><td>\${o.id}</td><td><span class="status">\${o.status}</span><div class="muted">\${o.subjectId || o.clientId || ''}</div></td><td>¥\${o.amount.toFixed(2)}</td><td>\${o.logisticsText || ''}</td></tr>\`).join('');
    }

    document.getElementById('saveBtn').addEventListener('click', async () => {
      try {
        await api('/api/admin/orders/' + encodeURIComponent(orderIdInput.value) + '/shipping', {
          method: 'PATCH',
          body: JSON.stringify({
            courierName: courierNameInput.value,
            trackingNumber: trackingNumberInput.value,
            statusCode: statusCodeInput.value,
            statusLabel: statusLabelInput.value
          })
        });
        await loadTables();
        alert('已保存发货信息');
      } catch (error) {
        alert(error.message);
      }
    });

    loadTables().catch((error) => {
      document.body.insertAdjacentHTML('beforeend', '<pre style="padding:24px;color:#b00020;">' + error.message + '</pre>');
    });
  </script>
</body>
</html>`;
}

function handleProducts(req, res) {
  json(res, 200, { data: readProducts() });
}

function handleAuthLogin(req, res) {
  return parseBody(req)
    .then((body) => {
      if (!body.code) {
        json(res, 400, { message: "code is required" });
        return null;
      }
      return exchangeCodeForSession(body.code).then((identity) => {
        const token = saveSession(identity.userId, body.profile || {});
        const user = getUserById(identity.userId);
        json(res, 200, {
          data: {
            token,
            userId: identity.userId,
            openid: identity.openid || "",
            unionid: identity.unionid || "",
            profile: (user && user.profile) || body.profile || {}
          }
        });
      });
    })
    .catch((error) => {
      json(res, 500, { message: error.message || "login failed" });
    });
}

function handleAuthMe(req, res) {
  const token = getBearerToken(req);
  const session = token ? findSession(token) : null;
  if (!session) return json(res, 401, { message: "unauthorized" });
  const user = getUserById(session.userId);
  json(res, 200, {
    data: {
      token,
      userId: session.userId,
      profile: (user && user.profile) || {}
    }
  });
}

function handleOrdersList(req, res, url) {
  const subjectId = getRequestSubject(req, url);
  const orders = readOrders()
    .filter((order) => {
      const owner = orderOwnerId(order);
      return subjectId ? owner === subjectId : true;
    })
    .map(publicOrderView);
  json(res, 200, { data: orders });
}

async function handleCreateOrder(req, res) {
  const body = await parseBody(req);
  const products = readProducts();
  const subjectId = body.subjectId || body.clientId || getRequestSubject(req, new URL(req.url, `http://${req.headers.host}`));
  const items = Array.isArray(body.items) ? body.items : [];
  if (!subjectId) {
    return json(res, 400, { message: "subjectId is required" });
  }
  if (!items.length) {
    return json(res, 400, { message: "items are required" });
  }
  const normalizedItems = items.map((item) => {
    const product = products.find((p) => p.id === item.id);
    const price = Number(item.price ?? (product ? product.price : 0));
    const quantity = Number(item.quantity || 1);
    return {
      id: item.id,
      name: item.name || (product && product.name) || "商品",
      price,
      quantity,
      subtotal: Number((price * quantity).toFixed(2)),
      spec: item.spec || (product && product.spec) || ""
    };
  });
  const now = new Date().toISOString();
  const order = {
    id: createOrderId(),
    subjectId,
    ownerType: body.ownerType || "guest",
    createdAt: now,
    updatedAt: now,
    statusCode: "pending",
    status: "待付款",
    items: normalizedItems,
    amount: Number(normalizedItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2)),
    customer: body.customer || {},
    logistics: {
      courierName: "",
      trackingNumber: "",
      statusLabel: "待发货",
      updatedAt: now
    },
    note: body.note || "",
    source: body.source || "miniprogram"
  };
  const orders = readOrders();
  orders.unshift(order);
  saveOrders(orders);
  json(res, 201, { data: publicOrderView(order) });
}

function handleOrderDetail(req, res, url, id) {
  const subjectId = getRequestSubject(req, url);
  const order = readOrders().find((item) => item.id === id);
  if (!order) return json(res, 404, { message: "order not found" });
  const owner = orderOwnerId(order);
  if (subjectId && owner !== subjectId) {
    return json(res, 403, { message: "forbidden" });
  }
  json(res, 200, { data: publicOrderView(order) });
}

function handleAdminOrders(req, res) {
  if (!adminAuth(req)) return json(res, 401, { message: "unauthorized" });
  json(res, 200, { data: readOrders().map(publicOrderView) });
}

async function handleAdminShipping(req, res, id) {
  if (!adminAuth(req)) return json(res, 401, { message: "unauthorized" });
  const body = await parseBody(req);
  const orders = readOrders();
  const index = orders.findIndex((item) => item.id === id);
  if (index < 0) return json(res, 404, { message: "order not found" });
  const now = new Date().toISOString();
  orders[index] = {
    ...orders[index],
    updatedAt: now,
    statusCode: body.statusCode || "shipping",
    status: body.statusCode === "done" ? "已完成" : "发货中",
    logistics: {
      courierName: body.courierName || orders[index].logistics?.courierName || "快递",
      trackingNumber: body.trackingNumber || orders[index].logistics?.trackingNumber || "",
      statusLabel: body.statusLabel || orders[index].logistics?.statusLabel || "已发货",
      updatedAt: now
    }
  };
  saveOrders(orders);
  json(res, 200, { data: publicOrderView(orders[index]) });
}

function handleOptions(req, res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token, Authorization, X-Subject-Id",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
  });
  res.end();
}

ensureSeedFiles();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "OPTIONS") return handleOptions(req, res);
    if (url.pathname === "/") return json(res, 200, { message: "Honey glider store backend is running" });
    if (url.pathname === "/admin") return sendHtml(res, renderAdminPage());
    if (url.pathname === "/api/health") return json(res, 200, { ok: true });
    if (url.pathname === "/api/products" && req.method === "GET") return handleProducts(req, res);
    if (url.pathname === "/api/auth/login" && req.method === "POST") return handleAuthLogin(req, res);
    if (url.pathname === "/api/auth/me" && req.method === "GET") return handleAuthMe(req, res);
    if (url.pathname === "/api/orders" && req.method === "GET") return handleOrdersList(req, res, url);
    if (url.pathname === "/api/orders" && req.method === "POST") return handleCreateOrder(req, res);
    if (url.pathname.startsWith("/api/orders/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      return handleOrderDetail(req, res, url, id);
    }
    if (url.pathname === "/api/admin/orders" && req.method === "GET") return handleAdminOrders(req, res);
    if (url.pathname.startsWith("/api/admin/orders/") && url.pathname.endsWith("/shipping") && req.method === "PATCH") {
      const id = decodeURIComponent(url.pathname.split("/")[4]);
      return handleAdminShipping(req, res, id);
    }
    json(res, 404, { message: "not found" });
  } catch (error) {
    json(res, 500, { message: error.message || "internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Backend running at http://127.0.0.1:${PORT}`);
  console.log(`Admin page: http://127.0.0.1:${PORT}/admin`);
  console.log(`Admin token: ${ADMIN_TOKEN}`);
});

