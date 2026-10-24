import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../dist/index.js";

const CONFIG = {
  code: 0,
  data: {
    agents: [{ name: "craft", models: ["auto", "plain"] }],
    models: [
      {
        id: "auto",
        name: "Auto",
        supportsToolCall: true,
        supportsReasoning: true,
        reasoning: { effort: "high", supportedEfforts: ["low", "high"], canDisableThinking: true },
      },
      { id: "plain", name: "Plain", supportsToolCall: true },
      { id: "hidden", name: "Hidden", supportsToolCall: true },
    ],
  },
};

const BILLING = {
  code: 0,
  data: {
    Response: {
      Data: {
        Accounts: [
          {
            CycleCapacitySize: 1000,
            CycleCapacityRemain: 250,
            CycleEndTime: "2026-11-01 08:00:00",
          },
        ],
        TotalDosage: 1000,
      },
    },
  },
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createEventStream() {
  const events = [];
  let index = 0;
  let aborted = false;
  let wake;
  const stream = {
    push(event) {
      events.push(event);
      wake?.();
    },
    abort() {
      aborted = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (!aborted) {
        if (index < events.length) {
          yield events[index++];
          continue;
        }
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
    },
  };
  return stream;
}

function createContext({ token = "test-token", declared, billing = BILLING, fetchImpl } = {}) {
  const state = {
    providers: new Map(),
    integration: { id: "codebuddy", name: "", methods: new Map() },
    hooks: new Map(),
    rpc: undefined,
    reloads: 0,
    requests: [],
    stream: createEventStream(),
  };

  if (declared) {
    state.providers.set("codebuddy", {
      provider: {
        id: "codebuddy",
        name: "CodeBuddy",
        settings: { baseURL: declared.baseURL },
      },
      models: new Map((declared.models ?? []).map((model) => [model.id, model])),
    });
  }

  const providerEditor = {
    get: (id) => state.providers.get(id),
    add: ({ info, models }) => {
      state.providers.set(String(info.id), {
        provider: info,
        models: new Map(models.map((model) => [model.id, model])),
      });
    },
    update: (id, callback) => {
      const entry = state.providers.get(id);
      if (entry) callback(entry.provider);
    },
    models: {
      set: (id, models) => {
        const entry = state.providers.get(id);
        if (entry) entry.models = new Map(models.map((model) => [model.id, model]));
      },
    },
  };

  const integrationEditor = {
    update: (id, callback) => callback(state.integration),
    method: {
      update: (registration) => {
        state.integration.methods.set(String(registration.method.id), registration);
      },
    },
  };

  const ctx = {
    options: {},
    location: { directory: "/tmp/codebuddy-test" },
    provider: {
      transform: async (callback) => callback(providerEditor),
      reload: async () => {
        state.reloads += 1;
      },
    },
    integration: {
      transform: async (callback) => callback(integrationEditor),
      connection: {
        active: async () => (token ? { id: "connection" } : undefined),
        resolve: async () => (token ? { type: "oauth", access: token, refresh: "refresh" } : undefined),
      },
    },
    session: {
      hook: async (name, callback) => {
        state.hooks.set(name, callback);
      },
    },
    rpc: {
      register: async (_definition, handlers) => {
        state.rpc = handlers;
      },
    },
    event: {
      subscribe: async function* ({ signal }) {
        signal?.addEventListener("abort", () => state.stream.abort());
        yield* state.stream;
      },
    },
    app: {},
    agent: {},
    command: {},
    credential: {},
    experimental: {},
    mcp: {},
    model: {},
    generate: {},
    permission: {},
    plugin: {},
    reference: {},
    shell: {},
    skill: {},
    storage: {},
    tool: {},
    vcs: {},
    websearch: {},
    worktree: {},
    aisdk: {},
  };

  state.fetch = async (url, init = {}) => {
    const target = String(url);
    state.requests.push({ url: target, init });
    if (target.endsWith("/v3/config")) return json(CONFIG);
    if (target.endsWith("/v2/billing/meter/get-user-resource")) return json(billing);
    return json({});
  };

  return { ctx, state };
}

async function withFetch(fetchImpl, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

async function until(predicate, timeout = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("setup registers a provider with discovered models and reasoning variants", async () => {
  const { ctx, state } = createContext();
  await withFetch(state.fetch, async () => {
    const cleanup = await plugin.setup(ctx);
    const entry = state.providers.get("codebuddy");
    assert.equal(entry.provider.activation, "auto");
    assert.equal(entry.provider.package, "@opencode/ai/providers/openai-compatible");
    assert.equal(entry.provider.settings.baseURL, "https://copilot.tencent.com/v2");
    assert.deepEqual([...entry.models.keys()], ["auto", "plain"]);
    assert.deepEqual(
      entry.models.get("auto").variants.map((variant) => variant.id),
      ["none", "low", "high"],
    );
    assert.equal(state.requests[0].url, "https://copilot.tencent.com/v3/config");
    assert.ok(state.rpc);
    assert.ok(state.integration.methods.has("ioa"));
    await cleanup?.();
  });
});

test("declared models win and the baseURL switches the edition", async () => {
  const { ctx, state } = createContext({
    declared: { baseURL: "https://www.codebuddy.ai/v2", models: [{ id: "custom" }] },
  });
  await withFetch(state.fetch, async () => {
    const cleanup = await plugin.setup(ctx);
    const entry = state.providers.get("codebuddy");
    assert.ok(entry.models.has("custom"));
    assert.ok(entry.models.has("auto"));
    assert.equal(entry.provider.package, "@opencode/ai/providers/openai-compatible");

    state.stream.push({
      type: "credential.updated",
      location: { directory: "/tmp/codebuddy-test" },
    });
    await until(() => state.reloads > 0);
    assert.ok(
      state.requests.some((request) => request.url === "https://www.codebuddy.ai/v3/config"),
    );

    const summary = await state.rpc.credits({});
    assert.equal(summary.ok, true);
    const billing = state.requests.find((request) =>
      request.url.includes("workbuddy.ai/v2/billing"),
    );
    assert.equal(
      billing.url,
      "https://www.workbuddy.ai/v2/billing/meter/get-user-resource",
    );
    assert.equal(billing.init.headers["X-Domain"], "workbuddy.ai");
    await cleanup?.();
  });
});

test("http.request rewrites the model, forces streaming and adds auth headers", async () => {
  const { ctx, state } = createContext({
    declared: { baseURL: "https://www.codebuddy.ai/v2", models: [] },
  });
  await withFetch(state.fetch, async () => {
    const cleanup = await plugin.setup(ctx);
    const hook = state.hooks.get("http.request");
    const event = {
      request: new Request("https://www.codebuddy.ai/v2/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", stream: false }),
      }),
    };
    await hook(event);

    const body = await event.request.json();
    assert.equal(body.model, "auto");
    assert.equal(body.stream, true);
    assert.equal(event.request.headers.get("x-domain"), "www.codebuddy.ai");
    assert.equal(event.request.headers.get("x-model-id"), "auto");
    assert.equal(event.request.headers.get("authorization"), "Bearer test-token");
    await cleanup?.();
  });
});

test("rpc credits aggregates the billing response", async () => {
  const { ctx, state } = createContext();
  await withFetch(state.fetch, async () => {
    const cleanup = await plugin.setup(ctx);
    const summary = await state.rpc.credits({});
    assert.equal(summary.ok, true);
    assert.equal(summary.totalRemain, 250);
    assert.equal(summary.totalUsed, 750);
    assert.equal(summary.usedPercent, 75);
    const billing = state.requests.find((request) =>
      request.url.endsWith("/v2/billing/meter/get-user-resource"),
    );
    assert.equal(billing.url, "https://www.codebuddy.cn/v2/billing/meter/get-user-resource");
    assert.equal(JSON.parse(billing.init.body).ProductCode, "p_tcaca");
    assert.equal(billing.init.headers.Authorization, "Bearer test-token");
    await cleanup?.();
  });
});

test("rpc credits reports a login error without a credential", async () => {
  const { ctx, state } = createContext({ token: "" });
  await withFetch(state.fetch, async () => {
    const cleanup = await plugin.setup(ctx);
    const summary = await state.rpc.credits({});
    assert.equal(summary.ok, false);
    assert.match(summary.error, /未登录/);
    await cleanup?.();
  });
});

test("http.response strips empty tool_calls from the SSE stream", async () => {
  const { ctx, state } = createContext();
  await withFetch(state.fetch, async () => {
    const cleanup = await plugin.setup(ctx);
    const hook = state.hooks.get("http.response");
    const response = new Response(
      'data: {"choices":[{"delta":{"tool_calls":[]}}]}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
    const event = { response };
    await hook(event);
    assert.equal(await event.response.text(), 'data: {"choices":[{"delta":{}}]}\n\n');
    await cleanup?.();
  });
});
