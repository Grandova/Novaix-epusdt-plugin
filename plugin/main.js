var paymentMethods = {
  usdt_tron: { label: "USDT · TRON (TRC20)", token: "usdt", network: "tron" },
  usdt_polygon: { label: "USDT · Polygon", token: "usdt", network: "polygon" },
  trx_tron: { label: "TRX · TRON", token: "trx", network: "tron" }
};

function getMethods() {
  var methods = typeof config.methods === "string" ? JSON.parse(config.methods) : config.methods;
  if (!Array.isArray(methods) || !methods.length) throw new Error("请选择 EPUSDT 支付方式");
  return methods.map(function (name) {
    if (!Object.prototype.hasOwnProperty.call(paymentMethods, name)) throw new Error("不支持的 EPUSDT 支付方式");
    return { name: name, label: paymentMethods[name].label };
  });
}

function epusdtSign(params) {
  if (typeof config.secret_key !== "string" || !config.secret_key) throw new Error("请填写 EPUSDT Secret Key");
  var parts = [];
  Object.keys(params).sort().forEach(function (key) {
    var value = params[key];
    if (key === "signature" || value === null || value === "") return;
    if (typeof value !== "string" && (typeof value !== "number" || !isFinite(value))) throw new Error("EPUSDT 签名参数类型无效");
    var text = String(value);
    // Go 使用 FormatFloat('f', -1)，微小币额也不能使用 JS 的科学计数法。
    if (typeof value === "number" && /e/i.test(text)) {
      var match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text);
      var digits = match[2] + (match[3] || "");
      var point = match[2].length + Number(match[4]);
      if (point <= 0) text = match[1] + "0." + new Array(1 - point).join("0") + digits;
      else if (point >= digits.length) text = match[1] + digits + new Array(point - digits.length + 1).join("0");
      else text = match[1] + digits.slice(0, point) + "." + digits.slice(point);
    }
    parts.push(key + "=" + text);
  });
  return crypto.hmacSHA256(config.secret_key, parts.join("&"));
}

function amountInCents(amount) {
  var text = String(amount);
  if (typeof amount !== "number" || !/^\d+(?:\.\d{1,2}0*)?$/.test(text)) throw new Error("EPUSDT 法币金额无效");
  var parts = text.split(".");
  var cents = Number(parts[0]) * 100 + Number(((parts[1] || "") + "00").slice(0, 2));
  if (cents <= 0 || cents > 1000000000000) throw new Error("EPUSDT 法币金额超出范围");
  return cents;
}

function createPayment(req) {
  var methods = getMethods();
  var method = req.method || (methods.length === 1 ? methods[0].name : "");
  if (!methods.some(function (item) { return item.name === method; })) throw new Error("请选择已启用的 EPUSDT 支付方式");
  if (typeof config.pid !== "string" || !config.pid.trim()) throw new Error("请填写 EPUSDT 商户 PID");
  if (!/^[A-Z]{3}$/.test(config.currency) || req.currency !== config.currency) throw new Error("EPUSDT 计价货币必须与 Novaix 订单货币一致");
  if (typeof req.orderNo !== "string" || !req.orderNo || req.orderNo.length > 32) throw new Error("EPUSDT 订单号必须为 1–32 个字符");
  if (typeof req.amount !== "number" || req.amount % 1 !== 0 || req.amount < 2 || req.amount > 1000000000000) throw new Error("EPUSDT 金额必须大于 0.01，且为有效的整数分");
  var apiUrl = String(config.api_url || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._~%-]+)*$/i.test(apiUrl)) throw new Error("请填写 EPUSDT 公网 HTTPS 地址，不含查询参数");
  var params = {
    pid: config.pid.trim(),
    order_id: req.orderNo,
    currency: req.currency.toLowerCase(),
    token: paymentMethods[method].token,
    network: paymentMethods[method].network,
    amount: req.amount / 100,
    notify_url: req.notifyURL,
    redirect_url: req.returnURL || "",
    name: req.subject || ""
  };
  params.signature = epusdtSign(params);
  var resp = http.request("POST", apiUrl + "/payments/gmpay/v1/order/create-transaction", {
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(params),
    timeout: 15
  });
  if (resp.status === 401) throw new Error("EPUSDT 鉴权失败：检查 PID、Secret Key、IP 白名单及是否为 v2.0 HMAC-SHA256 接口");
  var result;
  try { result = JSON.parse(resp.body); } catch (e) { throw new Error("EPUSDT 未返回 JSON，请检查服务地址和反向代理 (HTTP " + resp.status + ")"); }
  if (!result || resp.status !== 200 || result.status_code !== 200) throw new Error("EPUSDT 下单失败：" + (result && result.message ? result.message : "HTTP " + resp.status));
  var data = result.data;
  if (!data || data.order_id !== req.orderNo || amountInCents(data.amount) !== req.amount || data.currency !== req.currency ||
      typeof data.trade_id !== "string" || !data.trade_id || typeof data.payment_url !== "string" ||
      data.payment_url.indexOf(apiUrl + "/") !== 0) throw new Error("EPUSDT 下单响应的订单、金额、货币或收银台地址不匹配");
  return { payURL: data.payment_url, tradeNo: data.trade_id, qrCode: false };
}

function handleCallback(req) {
  if (req.method !== "POST" || typeof req.body !== "string") throw new Error("EPUSDT 回调必须为 POST JSON");
  var params = JSON.parse(req.body);
  if (!params || Array.isArray(params) || typeof params !== "object") throw new Error("EPUSDT 回调格式无效");
  if (typeof params.signature !== "string" || !/^[0-9a-f]{64}$/.test(params.signature)) throw new Error("EPUSDT 回调签名格式无效");
  var expected = epusdtSign(params);
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ params.signature.charCodeAt(i);
  if (mismatch !== 0) throw new Error("EPUSDT 回调签名验证失败");
  if (params.pid !== config.pid.trim()) throw new Error("EPUSDT 回调商户 PID 不匹配");
  if (typeof params.order_id !== "string" || !params.order_id || params.order_id.length > 32 ||
      typeof params.trade_id !== "string" || !params.trade_id) throw new Error("EPUSDT 回调订单号无效");
  if (params.status !== 2) throw new Error("EPUSDT 订单尚未支付成功");
  if (typeof params.block_transaction_id !== "string" || !params.block_transaction_id) throw new Error("EPUSDT 回调缺少交易凭据");
  if (!/^[A-Z]{3}$/.test(config.currency)) throw new Error("EPUSDT 计价货币配置无效");
  // GMPay 回调没有 currency；下单时已限定为配置的站点货币。
  return {
    orderNo: params.order_id,
    tradeNo: params.trade_id,
    amount: amountInCents(params.amount),
    currency: config.currency,
    success: true,
    rawData: req.body
  };
}

function callbackOKResponse() { return "ok"; }
function callbackFailResponse() { return "fail"; }
