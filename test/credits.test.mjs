import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCstDateTime,
  packageRemainUsed,
  parseCreditsResponse,
  summarizeCredits,
} from "../dist/credits.js";

test("packageRemainUsed prefers cycle capacity counters", () => {
  assert.deepEqual(
    packageRemainUsed({ CycleCapacitySize: 1000, CycleCapacityRemain: 300 }),
    { remain: 300, used: 700, size: 1000 },
  );
  assert.deepEqual(
    packageRemainUsed({
      CycleCapacitySize: 1000,
      CycleCapacityRemain: 300,
      CycleCapacityUsed: 800,
    }),
    { remain: 200, used: 800, size: 1000 },
  );
});

test("packageRemainUsed falls back through cycle and capacity counters", () => {
  assert.deepEqual(
    packageRemainUsed({
      CycleCapacityRemain: 50,
      CycleCapacityUsed: 150,
      CapacitySize: 400,
    }),
    { remain: 50, used: 350, size: 400 },
  );
  assert.deepEqual(
    packageRemainUsed({ CapacityRemain: 20, CapacitySize: 100 }),
    { remain: 20, used: 80, size: 100 },
  );
  assert.deepEqual(packageRemainUsed({}), { remain: 0, used: 0, size: 0 });
});

test("parseCreditsResponse unwraps the billing envelope", () => {
  const { accounts, payload } = parseCreditsResponse({
    Response: {
      Data: {
        Accounts: [{ CapacitySize: 10, CapacityRemain: 10 }],
        TotalDosage: 10,
      },
    },
  });
  assert.equal(accounts.length, 1);
  assert.equal(payload.TotalDosage, 10);
});

test("summarizeCredits aggregates packages and keeps the earliest expiry", () => {
  const summary = summarizeCredits(
    [
      {
        CycleCapacitySize: 1000,
        CycleCapacityRemain: 300,
        CycleEndTime: "2026-11-01 08:00:00",
      },
      {
        CapacitySize: 500,
        CapacityRemain: 500,
        DeductionEndTime: Date.parse("2026-12-01T08:00:00+08:00"),
      },
      { CycleCapacitySize: 0, CapacityRemain: 0 },
    ],
    {},
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.totalRemain, 800);
  assert.equal(summary.totalUsed, 700);
  assert.equal(summary.totalSize, 1500);
  assert.equal(summary.usedPercent, 46.67);
  assert.equal(summary.packCount, 3);
  assert.equal(summary.livePackCount, 2);
  assert.equal(summary.expiresAt, "2026-11-01T00:00:00.000Z");
});

test("summarizeCredits grows the size when TotalDosage is larger", () => {
  const summary = summarizeCredits(
    [{ CapacitySize: 100, CapacityRemain: 100 }],
    { TotalDosage: 200 },
  );
  assert.equal(summary.totalSize, 200);
  assert.equal(summary.totalUsed, 100);
  assert.equal(summary.usedPercent, 50);
});

test("formatCstDateTime renders an Asia/Shanghai timestamp", () => {
  const value = formatCstDateTime(new Date("2026-01-02T03:04:05Z"));
  assert.equal(value, "2026-01-02 11:04:05");
});
