import assert from "node:assert/strict";
import test from "node:test";
import { Provider } from "@opencode/plugin";
import {
  DEFAULT_MODEL,
  parseRemoteModels,
  remoteModelToInfo,
} from "../dist/models.js";

const providerID = Provider.ID.make("codebuddy");

function config(overrides = {}) {
  return {
    code: 0,
    data: {
      agents: [{ name: "craft", models: ["auto", "vision", "no-tools", "missing"] }],
      models: [
        { id: "auto", name: "Auto", supportsToolCall: true },
        { id: "vision", name: "Vision", supportsToolCall: true, supportsImages: true },
        { id: "no-tools", name: "No tools", supportsToolCall: false },
      ],
      ...overrides,
    },
  };
}

test("parseRemoteModels keeps only craft models that can call tools", () => {
  const models = parseRemoteModels(config());
  assert.deepEqual(models.map((model) => model.id), ["auto", "vision"]);
});

test("parseRemoteModels falls back to the auto model without a craft agent", () => {
  assert.deepEqual(parseRemoteModels({ code: 0, data: { models: [] } }), [DEFAULT_MODEL]);
  assert.deepEqual(parseRemoteModels({ code: 1, data: {} }), []);
});

test("parseRemoteModels applies tier colors and active promotions", () => {
  const models = parseRemoteModels(
    config({
      modelPromotions: [
        {
          modelIds: ["auto"],
          badge: { label: "限时", color: "#ff0000" },
          hover: { textZh: "活动" },
        },
      ],
      modelTiers: [
        { modelIds: ["vision"], tier: "advanced", badge: { label: "旗舰" } },
      ],
    }),
  );
  assert.equal(models[0].badge.label, "限时");
  assert.equal(models[0].hover.textZh, "活动");
  assert.equal(models[1].badge.color, "#C0701F");
});

test("remoteModelToInfo exposes reasoning efforts as variants", () => {
  const info = remoteModelToInfo(
    {
      id: "auto",
      name: "Auto",
      maxInputTokens: 200000,
      maxOutputTokens: 64000,
      supportsToolCall: true,
      supportsImages: true,
      supportsReasoning: true,
      onlyReasoning: true,
      reasoning: {
        effort: "high",
        summary: "auto",
        supportedEfforts: ["low", "high", "none", "low"],
        canDisableThinking: true,
      },
    },
    providerID,
  );

  assert.equal(info.id, "auto");
  assert.equal(info.limit.context, 200000);
  assert.equal(info.limit.output, 64000);
  assert.deepEqual(info.capabilities.input, ["text", "image"]);
  assert.equal(info.settings.reasoningEffort, "high");
  assert.equal(info.body.reasoning_summary, "auto");
  assert.deepEqual(info.variants.map((variant) => variant.id), ["none", "low", "high"]);
  assert.deepEqual(info.variants[0].settings, { reasoningEffort: "none" });
  assert.equal(info.compatibility.reasoningField, "reasoning_content");
  assert.equal(info.compatibility.requireReasoning, true);
  assert.equal(info.compatibility.supportsPromptCacheKey, true);
});

test("remoteModelToInfo omits variants for non-reasoning models", () => {
  const info = remoteModelToInfo(
    { id: "plain", name: "Plain", supportsToolCall: true },
    providerID,
  );
  assert.deepEqual(info.variants, []);
  assert.equal(info.compatibility.reasoningField, undefined);
  assert.equal(info.compatibility.supportsPromptCacheKey, true);
});

test("remoteModelToInfo appends the credits rate and TUI metadata", () => {
  const info = remoteModelToInfo(
    {
      id: "auto",
      name: "Auto",
      credits: "x1.5",
      descriptionZh: "自动选择",
      badge: { label: "推荐", color: "#00B159" },
      hover: { textZh: "适合日常任务" },
    },
    providerID,
  );
  assert.equal(info.name, "Auto (x1.5)");
  assert.equal(info.settings.tui.name, "Auto (x1.5)");
  assert.equal(info.settings.tui.descriptionZh, "自动选择");
  assert.deepEqual(info.settings.tui.badge, { label: "推荐", color: "#00B159" });
});
