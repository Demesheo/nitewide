import test from 'node:test';
import assert from 'node:assert/strict';
import { chartDateLabel, chartMoneyLabel, chartTick, chartTooltipStyles } from '../src/lib/chart-display.js';

test('chart currency axes convert cents once and keep large amounts compact', () => {
  assert.equal(chartMoneyLabel(0), '$0');
  assert.equal(chartMoneyLabel(25000), '$250');
  assert.equal(chartMoneyLabel(1000000), '$10K');
  assert.equal(chartMoneyLabel(125000000), '$1.3M');
});
test('date-only chart labels retain their calendar day regardless of local timezone', () => {
  assert.equal(chartDateLabel('2026-10-01'), 'Oct 1');
  assert.equal(chartDateLabel('2026-09-30'), 'Sep 30');
});
test('chart labels and tooltip values do not inherit low-contrast series colors', () => {
  assert.equal(chartTick.fontSize, 12);
  assert.equal(chartTooltipStyles.itemStyle.color, '#fafafa');
  assert.equal(chartTooltipStyles.labelStyle.color, '#fafafa');
  assert.equal(chartTooltipStyles.contentStyle.overflowWrap, 'anywhere');
});
