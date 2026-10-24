import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthHeaders,
  decodeJwtPayload,
  normalizeSseLine,
  normalizeSseResponse,
  resolveEnterpriseId,
  resolveTenantId,
  resolveUserId,
} from "../dist/auth.js";

function jwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${body}.signature`;
}

const ACCESS_TOKEN = jwt({
  iss: "https://sso.example.com/realms/sso-tenant-42",
  user_id: "user-7",
  realm_access: { roles: ["group-admin:ent-9"] },
});

test("decodeJwtPayload and identity resolvers read the IOA claims", () => {
  assert.equal(decodeJwtPayload(ACCESS_TOKEN).user_id, "user-7");
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
  assert.equal(resolveTenantId(ACCESS_TOKEN), "tenant-42");
  assert.equal(resolveEnterpriseId(ACCESS_TOKEN), "ent-9");
  assert.equal(resolveUserId(ACCESS_TOKEN), "user-7");
});

test("buildAuthHeaders adds IOA identity and tracing headers", () => {
  const headers = buildAuthHeaders(ACCESS_TOKEN, "auto", {
    serverUrl: "https://copilot.tencent.com",
    domain: "www.codebuddy.cn",
  });

  assert.equal(headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(headers["X-Model-ID"], "auto");
  assert.equal(headers["X-Tenant-Id"], "tenant-42");
  assert.equal(headers["X-Enterprise-Id"], "ent-9");
  assert.equal(headers["X-User-Id"], "user-7");
  assert.equal(headers["X-Domain"], "www.codebuddy.cn");
  assert.match(headers.b3, /^[0-9a-f]{32}-[0-9a-f]{16}-1-[0-9a-f]{16}$/);
});

test("normalizeSseLine drops empty tool_calls without touching other data", () => {
  const empty = 'data: {"choices":[{"delta":{"tool_calls":[],"content":"hi"}}]}';
  assert.equal(
    normalizeSseLine(empty),
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
  );

  const crlf = 'data: {"choices":[{"delta":{"tool_calls":[]}}]}\r';
  assert.equal(normalizeSseLine(crlf), 'data: {"choices":[{"delta":{}}]}\r');

  const realToolCall = 'data: {"choices":[{"delta":{"tool_calls":[{"id":"1"}]}}]}';
  assert.equal(normalizeSseLine(realToolCall), realToolCall);
  assert.equal(normalizeSseLine("data: [DONE]"), "data: [DONE]");
  assert.equal(normalizeSseLine("event: message"), "event: message");
  assert.equal(normalizeSseLine("data: not-json"), "data: not-json");
});

test("normalizeSseResponse rewrites streamed chunks", async () => {
  const encoder = new TextEncoder();
  const chunk = 'data: {"choices":[{"delta":{"tool_calls":[]}}]}\n\n';
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream", "content-length": "64" },
  });

  const normalized = normalizeSseResponse(response);
  assert.equal(normalized.headers.get("content-length"), null);
  assert.equal(await normalized.text(), 'data: {"choices":[{"delta":{}}]}\n\n');
});

test("normalizeSseResponse passthrough for JSON responses", async () => {
  const response = new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const normalized = normalizeSseResponse(response);
  assert.equal(await normalized.text(), "{}");
});
