function formatPrice(value) {
  return `¥${Number(value).toFixed(2)}`;
}

function formatDate(value) {
  const date = new Date(value);
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  formatPrice,
  formatDate
};

