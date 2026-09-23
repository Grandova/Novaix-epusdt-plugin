import hashlib
import importlib.util
import json
import tempfile
import urllib.request
from pathlib import Path

revision = "619cecb11d6bbd1dcdd1b698ee08b37fc722d3e3"
sdk_url = f"https://raw.githubusercontent.com/GMWalletApp/epusdt/{revision}/sdk/python/gmpay_create_order.py"
sdk_source = urllib.request.urlopen(sdk_url, timeout=30).read()
secret = "test-only-epusdt-secret"
fixtures = []
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "gmpay_create_order.py"
    path.write_bytes(sdk_source)
    spec = importlib.util.spec_from_file_location("upstream_gmpay", path)
    sdk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sdk)
    for method, token, network in (("usdt_tron", "usdt", "tron"), ("usdt_polygon", "usdt", "polygon"), ("trx_tron", "trx", "tron")):
        params = dict(pid="1000", order_id="PAY202609230001", currency="cny", token=token, network=network,
                      amount=42.29, notify_url="https://panel.example.com/api/callbacks/epusdt",
                      redirect_url="https://panel.example.com/portal/billing", name="云服务器 + 测试 & 续费")
        canonical, signature = sdk.make_signature(params, secret)
        fixtures.append(dict(name=method, canonical=canonical, params={**params, "signature": signature}))
    callback = dict(pid="1000", trade_id="epusdt-trade-1", order_id="PAY202609230001", amount=42.29,
                    actual_amount=5.8723, receive_address="TTestReceiver", token="USDT",
                    block_transaction_id="test-chain-transaction", status=2)
    cases = {
        "paid": callback,
        "tiny_crypto": {**callback, "actual_amount": 1e-8},
        "pending": {**callback, "status": 1},
        "expired": {**callback, "status": 3},
        "wrong_pid": {**callback, "pid": "2000"},
        "fractional_cent": {**callback, "amount": 42.291},
        "negative_amount": {**callback, "amount": -1},
        "missing_tx": {**callback, "block_transaction_id": ""},
        "numeric_edges": {"zero": 0, "tiny": 1e-8, "large": 1e21, "negative": -1e-7, "empty": "", "null": None},
    }
    for name, params in cases.items():
        canonical, signature = sdk.make_signature(params, secret)
        fixtures.append(dict(name=name, canonical=canonical, params={**params, "signature": signature}))

output = Path(__file__).parent / "fixtures.json"
output.write_text(json.dumps(dict(source=sdk_url, source_sha256=hashlib.sha256(sdk_source).hexdigest(),
                                 secret=secret, fixtures=fixtures), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(output)
