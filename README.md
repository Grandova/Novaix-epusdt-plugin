# Novaix EPUSDT 插件

在 Novaix 中使用已部署的 GMWallet EPUSDT 收款。用户选择支付方式后进入 EPUSDT 收银台，EPUSDT 确认到账并回调 Novaix。插件直接连接 EPUSDT，无需额外部署中转服务，也不修改主题或 Novaix 前端。

## 适用版本

- Novaix：插件声明 `>=0.4.4 <0.5.0`，依据官方 payment 插件接口实现。
- EPUSDT：GMWallet `v2.0.0`，GMPay HMAC-SHA256 接口。
- 2026-09-23 核对 Docker Hub 时，`gmwallet/epusdt:latest`、`v2.0.0` 和 `sha-619cecb-alpine` 指向同一镜像摘要：`sha256:9d2fef82fb875e83f968870bee010ce593ef7bcb5362d09ef1c7f871fa27c55e`。
- `latest` 不会自动更新已经创建的容器。本插件不使用旧版 MD5 GMPay 接口，也不会在验签失败后降级。

支持的方式：USDT / TRON（TRC20）、USDT / Polygon、TRX / TRON（原生币）。实际可收款的网络、代币合约、钱包和汇率由你的 EPUSDT 实例决定；只勾选已经配置好的方式。

## 安装和配置

1. 从 [Release v1.0.0](https://github.com/Grandova/Novaix-epusdt-plugin/releases/tag/v1.0.0) 下载 **`epusdt-1.0.0.zip`**，上传到 Novaix 后台 → 插件管理 → 上传安装。本地打包产物位于 `dist/`。
2. 在 EPUSDT 后台配置所需网络的钱包地址与汇率，并在 API 密钥管理中查看已启用的 **PID 和 Secret Key**。
3. 打开 Novaix 中 EPUSDT 插件的配置，填写：

| 字段 | 填写内容 |
| --- | --- |
| EPUSDT 地址 | 公网 HTTPS 根地址，例如 `https://pay.example.com`，不附加 API 路径 |
| 商户 PID | EPUSDT API 密钥对应的 PID，例如 `1000`，以你实际配置为准 |
| Secret Key | 同一条 API 密钥对应的 Secret Key |
| 面板计价货币 | 与 Novaix 站点货币一致，默认 `CNY`；EPUSDT 须配置该货币的汇率 |
| 支付方式 | 勾选 EPUSDT 已配置完成的 USDT/TRON、USDT/Polygon、TRX/TRON |

4. 启用插件，进入门户充值或订单支付页面测试。

**收款地址和汇率在 EPUSDT 配置，Novaix 插件配置连接凭证。** Secret Key 不是钱包私钥，也不是 EPUSDT 管理员登录密码。若 API 密钥启用了 IP 白名单，应包含 Novaix 服务器的出口 IP。

你已有的 Docker `-p 8000:8000` 服务需要通过公网 HTTPS 地址访问。Novaix 插件宿主禁止访问 `localhost`、容器服务名或解析到内网 IP 的域名。Novaix 本身也要配置正确的公网站点 URL，让 EPUSDT 能回调。

回调地址随每笔订单由 Novaix 的 `req.notifyURL` 自动传递；配置页显示的地址用于检查，无需手动拼接或设置定时任务。`novaix-epusdt-1.0.0-source.zip` 是源码包，不要上传到插件管理。

## 支付处理

- 下单：`POST /payments/gmpay/v1/order/create-transaction`，JSON 请求，金额由 Novaix 的整数分转换为法币单位。
- 签名：除 `signature` 和空值外按字段排序，生成 HMAC-SHA256 小写十六进制签名。回调同样验签，并校验 PID、支付成功状态和交易凭据。
- 回调返回的 Novaix 金额取自法币 `amount`，不使用加密货币数量 `actual_amount`。
- GMPay 回调没有 `currency` 字段，插件在下单时校验站点计价货币，回调时返回该配置值。有待支付订单时不要变更计价货币、PID 或 Secret Key。
- 仅处理成功状态 `2`，成功应答为纯文本 `ok`；异常不确认收款。Novaix 负责校验支付单金额和幂等入账。
- EPUSDT v2.0 要求订单号最多 32 字符、金额大于 0.01 法币单位，插件不会截断订单号或擅自加价。
- EPUSDT 收银台是否允许切换网络由 EPUSDT 决定；这里选择的支付方式用于初始化下单网络。

## 验证与打包

```sh
node --test tests/plugin.test.cjs
go test ./tests
go vet ./tests
python package.py
```

签名测试数据由固定版本的 EPUSDT 官方 Python SDK 生成，记录于 `tests/fixtures.json`。重新生成需要联网：

```sh
python tests/generate_fixtures.py
```

已验证官方 SDK 签名向量、三种方式的下单报文、金额转换、伪造及异常回调拒绝，并在 Goja 中运行插件下单和回调函数。HTTP 端使用测试响应；这不是完整 EPUSDT 服务或真实 Novaix 面板的支付验收。上线前应在自己的面板完成小额支付，确认到账、回调和余额/订单状态一致，并确认重复通知不会重复入账。

## 参考

- [Novaix 插件文档](https://docs.huohuastudio.com/novaix/plugin)
- [Novaix 官方 epay 插件](https://github.com/huohuastudio/novaix-releases/blob/main/plugins/epay.zip)
- [EPUSDT v2.0.0 发布说明](https://github.com/GMWalletApp/epusdt/releases/tag/v2.0.0)
- [EPUSDT API 文档](https://www.epusdt.com/api/payment)
- [EPUSDT v2.0.0 官方 Python SDK](https://github.com/GMWalletApp/epusdt/blob/v2.0.0/sdk/python/gmpay_create_order.py)

插件为独立的 JavaScript API 对接实现。测试时下载的上游 SDK 仅在临时目录运行，不包含在插件安装包或源码包内。
