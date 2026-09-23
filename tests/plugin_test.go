package epusdttest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/dop251/goja"
)

func TestGojaPaymentAndCallback(t *testing.T) {
	source, err := os.ReadFile("../plugin/main.js")
	if err != nil {
		t.Fatal(err)
	}
	fixtureBytes, err := os.ReadFile("fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Secret   string
		Fixtures []struct {
			Name   string
			Params map[string]interface{}
		}
	}
	if err := json.Unmarshal(fixtureBytes, &data); err != nil {
		t.Fatal(err)
	}
	fixtures := make(map[string]map[string]interface{})
	for _, fixture := range data.Fixtures {
		fixtures[fixture.Name] = fixture.Params
	}
	vm := goja.New()
	vm.Set("config", map[string]interface{}{
		"api_url": "https://pay.example.com", "pid": "1000", "secret_key": data.Secret,
		"currency": "CNY", "methods": `["usdt_tron","usdt_polygon","trx_tron"]`,
	})
	vm.Set("crypto", map[string]interface{}{"hmacSHA256": func(key, text string) string {
		mac := hmac.New(sha256.New, []byte(key))
		mac.Write([]byte(text))
		return hex.EncodeToString(mac.Sum(nil))
	}})
	requests := 0
	vm.Set("http", map[string]interface{}{"request": func(method, url string, opts map[string]interface{}) map[string]interface{} {
		requests++
		if method != "POST" || url != "https://pay.example.com/payments/gmpay/v1/order/create-transaction" {
			t.Fatalf("unexpected request: %s %s", method, url)
		}
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(opts["body"].(string)), &params); err != nil {
			t.Fatal(err)
		}
		name := "usdt_tron"
		if params["network"] == "polygon" {
			name = "usdt_polygon"
		} else if params["token"] == "trx" {
			name = "trx_tron"
		}
		if !reflect.DeepEqual(params, fixtures[name]) {
			t.Fatalf("request differs from upstream SDK fixture: %#v", params)
		}
		return map[string]interface{}{"status": 200, "body": `{"status_code":200,"data":{"order_id":"PAY202609230001","trade_id":"epusdt-trade-1","amount":42.29,"currency":"CNY","payment_url":"https://pay.example.com/pay/1"}}`}
	}})
	if _, err := vm.RunString(string(source)); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range data.Fixtures {
		vm.Set("params", fixture.Params)
		value, err := vm.RunString("epusdtSign(params)")
		if err != nil || value.String() != fixture.Params["signature"] {
			t.Fatalf("upstream signature mismatch: %s, %v", fixture.Name, err)
		}
	}
	for _, method := range []string{"usdt_tron", "usdt_polygon", "trx_tron"} {
		vm.Set("selectedMethod", method)
		value, err := vm.RunString(`createPayment({method:selectedMethod,orderNo:"PAY202609230001",amount:4229,currency:"CNY",subject:"云服务器 + 测试 & 续费",notifyURL:"https://panel.example.com/api/callbacks/epusdt",returnURL:"https://panel.example.com/portal/billing"}).tradeNo`)
		if err != nil || value.String() != "epusdt-trade-1" {
			t.Fatal("createPayment failed", err)
		}
	}
	for _, name := range []string{"paid", "tiny_crypto", "pending", "expired", "wrong_pid", "fractional_cent", "negative_amount", "missing_tx"} {
		body, _ := json.Marshal(fixtures[name])
		vm.Set("notice", map[string]interface{}{"method": "POST", "body": string(body)})
		value, err := vm.RunString("handleCallback(notice).amount")
		if name == "paid" || name == "tiny_crypto" {
			if err != nil || value.ToInteger() != 4229 {
				t.Fatalf("callback %s failed: %v", name, err)
			}
		} else if err == nil {
			t.Fatalf("invalid callback accepted: %s", name)
		}
	}
	if requests != 3 {
		t.Fatalf("unexpected HTTP calls: %d", requests)
	}
	value, err := vm.RunString("callbackOKResponse()")
	if err != nil || value.String() != "ok" {
		t.Fatal("invalid callback acknowledgement", err)
	}
}
