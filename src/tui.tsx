/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { CreditsSummary } from "./credits.js";
import { creditsRpc } from "./rpc.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const BAR_WIDTH = 10;

function formatCredits(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatExpiry(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function progressBar(percent: number): string {
  const used = Math.min(Math.max(percent, 0), 100);
  const filled = Math.round((used / 100) * BAR_WIDTH);
  return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`;
}

function failed(message: string): CreditsSummary {
  return {
    ok: false,
    totalRemain: 0,
    totalUsed: 0,
    totalSize: 0,
    usedPercent: 0,
    packCount: 0,
    livePackCount: 0,
    expiresAt: null,
    error: message,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("积分请求超时")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function CreditsPanel(props: { context: Context }) {
  const context = props.context;
  const theme = context.theme;
  const rpc = context.client.rpc(creditsRpc);
  const [tick, setTick] = createSignal(0);

  const [credits] = createResource(tick, async () => {
    try {
      return (await withTimeout(rpc.credits({}), REQUEST_TIMEOUT_MS)) as CreditsSummary;
    } catch (error) {
      return failed(error instanceof Error ? error.message : "积分请求失败");
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

  return (
    <box gap={1}>
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={refresh}
      >
        <text fg={theme.text.base}>
          <b>CodeBuddy 积分</b>
        </text>
        <text fg={theme.text.muted}>{credits.loading ? "刷新中…" : "↻"}</text>
      </box>
      <Show
        when={credits()}
        fallback={<text fg={theme.text.muted}>加载中…</text>}
      >
        {(summary) => (
          <Show
            when={summary().ok}
            fallback={
              <text fg={theme.text.muted}>{summary().error || "积分不可用"}</text>
            }
          >
            <box gap={0}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text.base}>
                  <b>{formatCredits(summary().totalRemain)}</b>
                </text>
                <text fg={theme.text.muted}>剩余积分</text>
              </box>
              <text fg={theme.text.muted}>
                已用 {formatCredits(summary().totalUsed)} / {formatCredits(summary().totalSize)}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text.base}>{progressBar(usedPercent())}</text>
                <text fg={theme.text.muted}>{usedPercent().toFixed(0)}%</text>
              </box>
              <Show when={formatExpiry(summary().expiresAt)}>
                {(expiry) => <text fg={theme.text.muted}>有效期至 {expiry()}</text>}
              </Show>
            </box>
          </Show>
        )}
      </Show>
    </box>
  );
}

export default Plugin.define({
  id: "codebuddy-auth-tui",
  setup(context) {
    const offSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => <CreditsPanel context={context} />,
    });

    return () => {
      offSlot();
    };
  },
});
