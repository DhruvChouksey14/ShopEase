#!/usr/bin/env bash
set -u

# Required environment variables:
#   TOKEN: valid access-token value for the verify-payment check
#   ORDER_ID: order id owned by TOKEN's user

BASE_URL="${BASE_URL:-http://localhost:4000}"
TOKEN="${TOKEN:-}"
ORDER_ID="${ORDER_ID:-}"
failed=0

pass() {
     printf 'PASS: %s\n' "$1"
}

fail() {
     printf 'FAIL: %s\n' "$1"
     failed=1
}

if curl -fsS --max-time 10 -o /dev/null -X POST "$BASE_URL/api/ai/events" \
     -H 'Content-Type: application/json' \
     -H 'x-user-id: victim' \
     --data '{"eventType":"verify-fixes"}'; then
     logs="$(docker logs ai-service --tail 50 2>&1)"
     if grep -Fq 'victim' <<< "$logs"; then
          fail 'forged x-user-id is absent from AI service logs'
     else
          pass 'forged x-user-id is absent from AI service logs'
     fi
else
     fail 'AI events request completed successfully'
fi

webhook_status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
     -X POST "$BASE_URL/api/payments/webhooks/razorpay" \
     -H 'Content-Type: application/json' \
     -H 'x-razorpay-signature: invalid' \
     --data '{"event":"payment.captured"}')"
if [[ "$webhook_status" =~ ^4[0-9][0-9]$ ]]; then
     pass "bad Razorpay webhook returns $webhook_status"
else
     fail "bad Razorpay webhook returned $webhook_status instead of 4xx"
fi

if [[ -z "$TOKEN" || -z "$ORDER_ID" ]]; then
     fail 'TOKEN and ORDER_ID are required for verify-payment'
else
     verify_status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
          -X POST "$BASE_URL/api/orders/$ORDER_ID/verify-payment" \
          -H "Cookie: accessToken=$TOKEN" \
          -H 'Content-Type: application/json' \
          --data '{"razorpayPaymentId":"verify-fixes-payment","razorpaySignature":"not-hex"}')"
     if [[ "$verify_status" == '400' ]]; then
          pass 'non-hex payment signature returns 400'
     else
          fail "non-hex payment signature returned $verify_status instead of 400"
     fi
fi

exit "$failed"
