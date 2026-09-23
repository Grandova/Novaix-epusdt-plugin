const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../plugin/main.js"), "utf8");
const data = require("./fixtures.json");
const fixtures = Object.fromEntries(data.fixtures.map((fixture) => [fixture.name, fixture.params]));
const request = { orderNo: "PAY202609230001", amount: 4229, currency: "CNY", subject: "云服务器 + 测试 & 续费",
  notifyURL: "https://panel.example.com/api/callbacks/epusdt", returnURL: "https://panel.example.com/portal/billing" };

function runtime(overrides = {}, response) {
  const context = vm.createContext({
    config: { api_url: "https://pay.example.com/", pid: "1000", secret_key: data.secret,
      currency: "CNY", methods: '["usdt_tron","usdt_polygon","trx_tron"]', ...overrides },
    crypto: { hmacSHA256: (key, text) => crypto.createHmac("sha256", key).update(text).digest("hex") },
    http: { request(method, url, opts) {
      assert.equal(method, "POST");
      assert.equal(url, "https://pay.example.com/payments/gmpay/v1/order/create-transaction");
      assert.equal(opts.headers["Content-Type"], "application/json");
      assert.equal(opts.timeout, 15);
      const params = JSON.parse(opts.body);
      const expected = params.network === "polygon" ? fixtures.usdt_polygon : params.token === "trx" ? fixtures.trx_tron : fixtures.usdt_tron;
      assert.deepEqual(params, expected);
      return response || { status: 200, body: JSON.stringify({ status_code: 200, data: { order_id: params.order_id,
        trade_id: "epusdt-trade-1", amount: params.amount, currency: "CNY", payment_url: "https://pay.example.com/pay/checkout-counter/epusdt-trade-1" } }) };
    } },
  });
  vm.runInContext(source, context);
  return context;
}

test("所有签名与固定上游 Python SDK 输出一致，包括科学计数法", () => {
  const context = runtime();
  for (const fixture of data.fixtures) assert.equal(context.epusdtSign(fixture.params), fixture.params.signature, fixture.name);
});

test("三种支付方式发送上游 SDK 可验证的下单报文", () => {
  const context = runtime();
  assert.equal(context.getMethods().length, 3);
  for (const method of ["usdt_tron", "usdt_polygon", "trx_tron"]) {
    const result = context.createPayment({ ...request, method });
    assert.equal(result.tradeNo, "epusdt-trade-1");
    assert.equal(result.qrCode, false);
    assert.equal(result.payURL, "https://pay.example.com/pay/checkout-counter/epusdt-trade-1");
  }
  assert.equal(runtime({ methods: ["usdt_tron"] }).createPayment(request).tradeNo, "epusdt-trade-1");
});

test("回调使用法币金额，不把 actual_amount 币数当作充值金额", () => {
  const context = runtime();
  for (const name of ["paid", "tiny_crypto"]) {
    const result = context.handleCallback({ method: "POST", body: JSON.stringify(fixtures[name]) });
    assert.equal(result.amount, 4229);
    assert.equal(result.currency, "CNY");
    assert.equal(result.orderNo, request.orderNo);
    assert.equal(result.tradeNo, "epusdt-trade-1");
    assert.equal(result.success, true);
    assert.equal(result.rawData, JSON.stringify(fixtures[name]));
  }
  assert.equal(context.callbackOKResponse(), "ok");
  assert.equal(context.callbackFailResponse(), "fail");
});

test("重复通知返回同一订单，由 Novaix 执行幂等入账", () => {
  const context = runtime();
  const notice = { method: "POST", body: JSON.stringify(fixtures.paid) };
  assert.deepEqual(context.handleCallback(notice), context.handleCallback(notice));
});

test("已签名的未付款、错商户、无凭据和不合法金额均拒绝", () => {
  const context = runtime();
  for (const name of ["pending", "expired", "wrong_pid", "fractional_cent", "negative_amount", "missing_tx"]) {
    assert.throws(() => context.handleCallback({ method: "POST", body: JSON.stringify(fixtures[name]) }), undefined, name);
  }
});

test("篡改金额、缺少或旧版签名、错误请求格式拒绝", () => {
  const context = runtime();
  for (const params of [{ ...fixtures.paid, amount: 4229 }, { ...fixtures.paid, order_id: "other-order" },
    { ...fixtures.paid, signature: "a".repeat(32) }, { ...fixtures.paid, signature: "0".repeat(64) },
    { ...fixtures.paid, signature: undefined }, [], null]) {
    assert.throws(() => context.handleCallback({ method: "POST", body: JSON.stringify(params) }));
  }
  assert.throws(() => context.handleCallback({ method: "GET", body: JSON.stringify(fixtures.paid) }));
  assert.throws(() => context.handleCallback({ method: "POST", body: "{invalid" }));
});

test("错误货币、方式、配置及超过 32 位订单号不会下单", () => {
  const context = runtime();
  for (const change of [{}, { method: "bad" }, { method: "usdt_tron", currency: "USD" },
    { method: "usdt_tron", amount: 1 }, { method: "usdt_tron", amount: 1.5 },
    { method: "usdt_tron", orderNo: "x".repeat(33) }]) {
    assert.throws(() => context.createPayment({ ...request, ...change }));
  }
  for (const config of [{ methods: ["__proto__"] }, { api_url: "http://pay.example.com" },
    { secret_key: "" }, { pid: "" }, { currency: "" }]) {
    assert.throws(() => runtime(config).createPayment({ ...request, method: "usdt_tron" }));
  }
});

test("网关错误、非 JSON 和不匹配的下单响应拒绝", () => {
  for (const response of [{ status: 401, body: "" }, { status: 502, body: "<html>bad gateway</html>" },
    { status: 200, body: JSON.stringify({ status_code: 10003, message: "无可用钱包" }) },
    { status: 200, body: "null" }]) {
    assert.throws(() => runtime({}, response).createPayment({ ...request, method: "usdt_tron" }));
  }
  const good = { trade_id: "trade", order_id: request.orderNo, amount: 42.29, currency: "CNY", payment_url: "https://pay.example.com/pay/1" };
  for (const change of [{ amount: 42.28 }, { currency: "USD" }, { order_id: "other" },
    { trade_id: "" }, { payment_url: "javascript:alert(1)" }, { payment_url: "https://pay.example.com.evil/pay/1" }]) {
    assert.throws(() => runtime({}, { status: 200, body: JSON.stringify({ status_code: 200, data: { ...good, ...change } }) })
      .createPayment({ ...request, method: "usdt_tron" }));
  }
});
