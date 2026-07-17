const { request } = require("./api");
const { getGuestId, getSubjectId, isLoggedIn } = require("./session");

const PRODUCTS_KEY = "sg_products";
const CART_KEY = "sg_cart";
const ORDERS_KEY = "sg_orders";
const ADDRESSES_KEY = "sg_addresses";
const CHECKOUT_DRAFT_KEY = "sg_checkout_draft";

const defaultProfile = {
  name: "私域用户",
  mobile: "未填写",
  address: "未设置收货地址",
  note: "下单后可在订单页跟踪状态"
};

const seedProducts = [
  {
    id: "p001",
    name: "经典主粮 500g",
    subtitle: "均衡营养，日常主食首选",
    price: 68,
    originalPrice: 78,
    tags: ["日常款", "高适口"],
    spec: "500g / 约25餐",
    desc: "适合成年蜜袋鼯日常主食，强调稳定营养与适口性。",
    badge: "热卖",
    active: true
  },
  {
    id: "p002",
    name: "高蛋白主粮 400g",
    subtitle: "适合成长与高活动期",
    price: 79,
    originalPrice: 89,
    tags: ["高蛋白", "成长期"],
    spec: "400g / 约20餐",
    desc: "更适合成长期、活动量更大的蜜袋鼯。",
    badge: "推荐",
    active: true
  },
  {
    id: "p003",
    name: "低敏轻食主粮 450g",
    subtitle: "温和配方，肠胃友好",
    price: 72,
    originalPrice: 82,
    tags: ["低敏", "肠胃友好"],
    spec: "450g / 约22餐",
    desc: "配方更温和，适合敏感体质或换粮期。",
    badge: "安心",
    active: true
  }
];

function read(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function write(key, value) {
  wx.setStorageSync(key, value);
}

function ensureSeedData() {
  if (!read(PRODUCTS_KEY, null)) write(PRODUCTS_KEY, seedProducts);
  if (!read(CART_KEY, null)) write(CART_KEY, []);
  if (!read(ORDERS_KEY, null)) write(ORDERS_KEY, []);
  if (!read(ADDRESSES_KEY, null)) write(ADDRESSES_KEY, []);
  getGuestId();
}

function getCachedProducts() {
  return read(PRODUCTS_KEY, seedProducts);
}

function cacheProducts(products) {
  write(PRODUCTS_KEY, products);
}

function getCachedOrders() {
  return read(ORDERS_KEY, []);
}

function cacheOrders(orders) {
  write(ORDERS_KEY, orders);
}

function getCachedAddresses() {
  return read(ADDRESSES_KEY, []);
}

function cacheAddresses(addresses) {
  write(ADDRESSES_KEY, addresses);
}

function getCart() {
  return read(CART_KEY, []);
}

function setCart(cart) {
  write(CART_KEY, cart);
}

function addToCart(productId, quantity = 1) {
  const cart = getCart();
  const existing = cart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.unshift({ productId, quantity });
  }
  setCart(cart);
}

function updateCartItem(productId, quantity) {
  const cart = getCart().filter((item) => item.productId !== productId);
  if (quantity > 0) {
    cart.push({ productId, quantity });
  }
  setCart(cart);
}

function clearCart() {
  setCart([]);
}

function getCartDetailed() {
  const cart = getCart();
  const products = getCachedProducts();
  return cart
    .map((item) => {
      const product = products.find((productItem) => productItem.id === item.productId);
      if (!product) return null;
      return {
        ...product,
        quantity: item.quantity,
        subtotal: Number((product.price * item.quantity).toFixed(2))
      };
    })
    .filter(Boolean);
}

function setCheckoutDraft(items, meta = {}) {
  write(CHECKOUT_DRAFT_KEY, {
    items,
    meta,
    createdAt: new Date().toISOString()
  });
}

function getCheckoutDraft() {
  return read(CHECKOUT_DRAFT_KEY, null);
}

function clearCheckoutDraft() {
  try {
    wx.removeStorageSync(CHECKOUT_DRAFT_KEY);
  } catch (error) {
    write(CHECKOUT_DRAFT_KEY, null);
  }
}

async function getProducts() {
  try {
    const response = await request("/api/products");
    const products = response.data || [];
    cacheProducts(products);
    return products;
  } catch (error) {
    return getCachedProducts();
  }
}

async function getProductById(id) {
  const products = await getProducts();
  return products.find((item) => item.id === id);
}

function formatOrderFallback(order) {
  if (!order) return null;
  return {
    ...order,
    logisticsText: order.logisticsText || (order.logistics && order.logistics.statusLabel) || "待发货"
  };
}

function buildLocalOrder(items, customer = {}, address = null, note = "") {
  const now = new Date().toISOString();
  const normalizedItems = items.map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    quantity: Number(item.quantity || 1),
    subtotal: Number((Number(item.price) * Number(item.quantity || 1)).toFixed(2)),
    spec: item.spec || ""
  }));
  const amount = Number(normalizedItems.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2));
  return {
    id: `OD${Date.now()}`,
    subjectId: getSubjectId(),
    ownerType: isLoggedIn() ? "wechat" : "guest",
    createdAt: now,
    updatedAt: now,
    statusCode: "pending_payment",
    status: "待支付",
    items: normalizedItems,
    amount,
    customer,
    addressId: address ? address.id : "",
    addressSnapshot: address || null,
    logistics: {
      courierName: "",
      trackingNumber: "",
      statusLabel: "待发货",
      updatedAt: now
    },
    logisticsText: "待发货",
    note,
    source: "local-fallback"
  };
}

async function getAddresses() {
  const subjectId = getSubjectId();
  try {
    const response = await request(`/api/addresses?subjectId=${encodeURIComponent(subjectId)}`);
    const addresses = response.data || [];
    cacheAddresses(addresses);
    return addresses;
  } catch (error) {
    return getCachedAddresses().filter((item) => item.subjectId === subjectId);
  }
}

async function getDefaultAddress() {
  const addresses = await getAddresses();
  return addresses.find((item) => item.isDefault) || addresses[0] || null;
}

async function saveAddress(address) {
  const payload = {
    ...address,
    subjectId: getSubjectId()
  };
  const method = payload.id ? "PATCH" : "POST";
  const path = payload.id ? `/api/addresses/${encodeURIComponent(payload.id)}` : "/api/addresses";
  try {
    const response = await request(path, {
      method,
      data: payload
    });
    const saved = response.data;
    const list = await getAddresses();
    const next = list.filter((item) => item.id !== saved.id);
    next.unshift(saved);
    cacheAddresses(next);
    return saved;
  } catch (error) {
    const list = getCachedAddresses().filter((item) => item.id !== payload.id);
    const saved = {
      ...payload,
      id: payload.id || `ADDR_${Date.now()}`,
      isDefault: payload.isDefault !== undefined ? payload.isDefault : list.length === 0,
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    list.unshift(saved);
    cacheAddresses(list);
    return saved;
  }
}

async function deleteAddress(addressId) {
  try {
    await request(`/api/addresses/${encodeURIComponent(addressId)}`, {
      method: "DELETE"
    });
  } finally {
    const next = getCachedAddresses().filter((item) => item.id !== addressId);
    cacheAddresses(next);
  }
}

async function setDefaultAddress(addressId) {
  try {
    const response = await request(`/api/addresses/${encodeURIComponent(addressId)}/default`, {
      method: "PATCH"
    });
    return response.data;
  } catch (error) {
    const list = getCachedAddresses().map((item) => ({
      ...item,
      isDefault: item.id === addressId
    }));
    cacheAddresses(list);
    return list.find((item) => item.id === addressId) || null;
  }
}

async function createOrder({ items, customer, address, note = "" }) {
  const payloadItems = items.map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price),
    quantity: Number(item.quantity || 1),
    spec: item.spec || "",
    subtotal: Number((Number(item.price) * Number(item.quantity || 1)).toFixed(2))
  }));
  const selectedAddress = address || (await getDefaultAddress());
  const payload = {
    subjectId: getSubjectId(),
    ownerType: isLoggedIn() ? "wechat" : "guest",
    items: payloadItems,
    customer: customer || {},
    addressId: selectedAddress ? selectedAddress.id : "",
    addressSnapshot: selectedAddress || null,
    note,
    source: "miniprogram"
  };

  try {
    const response = await request("/api/orders", {
      method: "POST",
      data: payload
    });
    const order = response.data;
    const cached = getCachedOrders();
    cached.unshift(order);
    cacheOrders(cached);
    clearCart();
    clearCheckoutDraft();
    return order;
  } catch (error) {
    const order = buildLocalOrder(payloadItems, customer, selectedAddress, note);
    const cached = getCachedOrders();
    cached.unshift(order);
    cacheOrders(cached);
    clearCart();
    clearCheckoutDraft();
    return formatOrderFallback(order);
  }
}

async function payOrder(orderId) {
  try {
    const response = await request(`/api/orders/${encodeURIComponent(orderId)}/pay`, {
      method: "POST"
    });
    return response.data;
  } catch (error) {
    const orders = getCachedOrders();
    const index = orders.findIndex((item) => item.id === orderId);
    if (index > -1) {
      orders[index] = {
        ...orders[index],
        statusCode: "paid",
        status: "已支付",
        updatedAt: new Date().toISOString()
      };
      cacheOrders(orders);
      return orders[index];
    }
    throw error;
  }
}

async function getOrders() {
  const subjectId = getSubjectId();
  try {
    const response = await request(`/api/orders?subjectId=${encodeURIComponent(subjectId)}`);
    const orders = response.data || [];
    cacheOrders(orders);
    return orders;
  } catch (error) {
    return getCachedOrders().filter((order) => order.subjectId === subjectId);
  }
}

async function getOrderById(orderId) {
  const subjectId = getSubjectId();
  try {
    const response = await request(`/api/orders/${encodeURIComponent(orderId)}?subjectId=${encodeURIComponent(subjectId)}`);
    return response.data || null;
  } catch (error) {
    const cached = getCachedOrders();
    return cached.find((item) => item.id === orderId && item.subjectId === subjectId) || null;
  }
}

async function getDashboard() {
  const orders = await getOrders();
  const summary = {
    pending_payment: 0,
    paid: 0,
    preparing: 0,
    shipping: 0,
    done: 0,
    cancelled: 0,
    total: orders.length
  };
  orders.forEach((order) => {
    if (summary[order.statusCode] !== undefined) {
      summary[order.statusCode] += 1;
    }
  });
  return summary;
}

module.exports = {
  ensureSeedData,
  getProducts,
  getProductById,
  getCart,
  getCartDetailed,
  addToCart,
  updateCartItem,
  clearCart,
  setCheckoutDraft,
  getCheckoutDraft,
  clearCheckoutDraft,
  getAddresses,
  getDefaultAddress,
  saveAddress,
  deleteAddress,
  setDefaultAddress,
  createOrder,
  payOrder,
  getOrders,
  getOrderById,
  getDashboard,
  defaultProfile
};

