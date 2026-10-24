// src/tui.tsx
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js";

// src/rpc.ts
var creditsRpc = {
  id: "codebuddy-auth",
  methods: {
    credits: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          totalRemain: { type: "number" },
          totalUsed: { type: "number" },
          totalSize: { type: "number" },
          usedPercent: { type: "number" },
          packCount: { type: "number" },
          livePackCount: { type: "number" },
          expiresAt: { type: ["string", "null"] },
          error: { type: "string" }
        },
        required: [
          "ok",
          "totalRemain",
          "totalUsed",
          "totalSize",
          "usedPercent",
          "packCount",
          "livePackCount",
          "expiresAt"
        ],
        additionalProperties: false
      }
    }
  },
  events: {}
};

// src/tui.tsx
var REFRESH_INTERVAL_MS = 5 * 60 * 1e3;
var REQUEST_TIMEOUT_MS = 1e4;
var BAR_WIDTH = 10;
function formatCredits(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}
function formatExpiry(value) {
  if (!value) return void 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return void 0;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function progressBar(percent) {
  const used = Math.min(Math.max(percent, 0), 100);
  const filled = Math.round(used / 100 * BAR_WIDTH);
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(BAR_WIDTH - filled)}`;
}
function failed(message) {
  return {
    ok: false,
    totalRemain: 0,
    totalUsed: 0,
    totalSize: 0,
    usedPercent: 0,
    packCount: 0,
    livePackCount: 0,
    expiresAt: null,
    error: message
  };
}
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("\u79EF\u5206\u8BF7\u6C42\u8D85\u65F6")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function CreditsPanel(props) {
  const context = props.context;
  const theme = context.theme;
  const rpc = context.client.rpc(creditsRpc);
  const [tick, setTick] = createSignal(0);
  const [credits] = createResource(tick, async () => {
    try {
      return await withTimeout(rpc.credits({}), REQUEST_TIMEOUT_MS);
    } catch (error) {
      return failed(error instanceof Error ? error.message : "\u79EF\u5206\u8BF7\u6C42\u5931\u8D25");
    }
  });
  const refresh = () => setTick((value) => value + 1);
  const usedPercent = createMemo(() => Math.min(Math.max(credits()?.usedPercent ?? 0, 0), 100));
  onMount(() => {
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    const offUpdated = context.data.on("credential.updated", refresh);
    const offSwitched = context.data.on("credential.switched", refresh);
    onCleanup(() => {
      clearInterval(timer);
      offUpdated();
      offSwitched();
    });
  });
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$4 = _$createElement("b"), _el$6 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$6);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "gap", 1);
    _$setProp(_el$2, "onMouseDown", refresh);
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$4, _$createTextNode(`CodeBuddy \u79EF\u5206`));
    _$insert(_el$6, () => credits.loading ? "\u5237\u65B0\u4E2D\u2026" : "\u21BB");
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return credits();
      },
      get fallback() {
        return (() => {
          var _el$7 = _$createElement("text");
          _$insertNode(_el$7, _$createTextNode(`\u52A0\u8F7D\u4E2D\u2026`));
          _$effect((_$p) => _$setProp(_el$7, "fg", theme.text.muted, _$p));
          return _el$7;
        })();
      },
      children: (summary) => _$createComponent(Show, {
        get when() {
          return summary().ok;
        },
        get fallback() {
          return (() => {
            var _el$20 = _$createElement("text");
            _$insert(_el$20, () => summary().error || "\u79EF\u5206\u4E0D\u53EF\u7528");
            _$effect((_$p) => _$setProp(_el$20, "fg", theme.text.muted, _$p));
            return _el$20;
          })();
        },
        get children() {
          var _el$9 = _$createElement("box"), _el$0 = _$createElement("box"), _el$1 = _$createElement("text"), _el$10 = _$createElement("b"), _el$11 = _$createElement("text"), _el$13 = _$createElement("text"), _el$14 = _$createTextNode(`\u5DF2\u7528 `), _el$15 = _$createTextNode(` / `), _el$16 = _$createElement("box"), _el$17 = _$createElement("text"), _el$18 = _$createElement("text"), _el$19 = _$createTextNode(`%`);
          _$insertNode(_el$9, _el$0);
          _$insertNode(_el$9, _el$13);
          _$insertNode(_el$9, _el$16);
          _$setProp(_el$9, "gap", 0);
          _$insertNode(_el$0, _el$1);
          _$insertNode(_el$0, _el$11);
          _$setProp(_el$0, "flexDirection", "row");
          _$setProp(_el$0, "gap", 1);
          _$insertNode(_el$1, _el$10);
          _$insert(_el$10, () => formatCredits(summary().totalRemain));
          _$insertNode(_el$11, _$createTextNode(`\u5269\u4F59\u79EF\u5206`));
          _$insertNode(_el$13, _el$14);
          _$insertNode(_el$13, _el$15);
          _$insert(_el$13, () => formatCredits(summary().totalUsed), _el$15);
          _$insert(_el$13, () => formatCredits(summary().totalSize), null);
          _$insertNode(_el$16, _el$17);
          _$insertNode(_el$16, _el$18);
          _$setProp(_el$16, "flexDirection", "row");
          _$setProp(_el$16, "gap", 1);
          _$insert(_el$17, () => progressBar(usedPercent()));
          _$insertNode(_el$18, _el$19);
          _$insert(_el$18, () => usedPercent().toFixed(0), _el$19);
          _$insert(_el$9, _$createComponent(Show, {
            get when() {
              return formatExpiry(summary().expiresAt);
            },
            children: (expiry) => (() => {
              var _el$21 = _$createElement("text"), _el$22 = _$createTextNode(`\u6709\u6548\u671F\u81F3 `);
              _$insertNode(_el$21, _el$22);
              _$insert(_el$21, expiry, null);
              _$effect((_$p) => _$setProp(_el$21, "fg", theme.text.muted, _$p));
              return _el$21;
            })()
          }), null);
          _$effect((_p$) => {
            var _v$3 = theme.text.base, _v$4 = theme.text.muted, _v$5 = theme.text.muted, _v$6 = theme.text.base, _v$7 = theme.text.muted;
            _v$3 !== _p$.e && (_p$.e = _$setProp(_el$1, "fg", _v$3, _p$.e));
            _v$4 !== _p$.t && (_p$.t = _$setProp(_el$11, "fg", _v$4, _p$.t));
            _v$5 !== _p$.a && (_p$.a = _$setProp(_el$13, "fg", _v$5, _p$.a));
            _v$6 !== _p$.o && (_p$.o = _$setProp(_el$17, "fg", _v$6, _p$.o));
            _v$7 !== _p$.i && (_p$.i = _$setProp(_el$18, "fg", _v$7, _p$.i));
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0,
            i: void 0
          });
          return _el$9;
        }
      })
    }), null);
    _$effect((_p$) => {
      var _v$ = theme.text.base, _v$2 = theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "fg", _v$2, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
var tui_default = Plugin.define({
  id: "codebuddy-auth-tui",
  setup(context) {
    const offSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => _$createComponent(CreditsPanel, {
        context
      })
    });
    return () => {
      offSlot();
    };
  }
});
export {
  tui_default as default
};
