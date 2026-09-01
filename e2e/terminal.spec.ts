import { merchantTest as test, expect } from './fixtures';
import { waitForAppReady, selectMerchantMode, navigateToTerminal, enterAmount } from './helpers';

test.describe('Terminal — POS keypad and QR generation', () => {
  test('navigates to terminal and shows header', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    // Navigate to terminal via bottom nav
    await navigateToTerminal(testHost);
  });

  test('enters digits via keypad and displays amount', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);
    await navigateToTerminal(testHost);

    // Cents-based entry: "42" → keypad presses 4,2,0,0 → 42.00
    await enterAmount(frame, '42');

    await expect(
      frame.locator('[data-testid="amount-display"]'),
    ).toHaveText('42.00');
  });

  test('enters decimal amount', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);
    await navigateToTerminal(testHost);

    // "12.50" → keypad presses 1,2,5,0
    await enterAmount(frame, '12.50');

    await expect(
      frame.locator('[data-testid="amount-display"]'),
    ).toHaveText('12.50');
  });

  test('backspace removes last digit', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);
    await navigateToTerminal(testHost);

    await enterAmount(frame, '123');
    await expect(frame.locator('[data-testid="amount-display"]')).toHaveText('123.00');

    // Digits shift right out of the cents slot: 123.00 → 12.30
    await frame.locator('[data-testid="calc-backspace"]').click();
    await expect(frame.locator('[data-testid="amount-display"]')).toHaveText('12.30');
  });

  test('Charge button is disabled with zero amount', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);
    await navigateToTerminal(testHost);

    await expect(
      frame.locator('[data-testid="btn-charge"]'),
    ).toBeDisabled();
  });

  test('review step shows total and note field before the QR', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);
    await navigateToTerminal(testHost);

    await enterAmount(frame, '5');
    await frame.locator('[data-testid="btn-charge"]').click();

    // Symbol comes from useAssetSymbol() → PUSD_SYMBOL ("CASH"), see lib/utils/asset-ids.ts
    await expect(
      frame.locator('[data-testid="review-total"]'),
    ).toHaveText('5.00 CASH');
    await expect(frame.locator('[data-testid="review-note"]')).toBeVisible();
  });

  test('generates QR code and shows waiting state', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);
    await navigateToTerminal(testHost);

    // Enter an amount, charge, then confirm the review step
    await enterAmount(frame, '5');
    await frame.locator('[data-testid="btn-charge"]').click();
    await frame.locator('[data-testid="btn-generate-qr"]').click();

    // Should transition to QR / waiting state
    await expect(
      frame.locator('[data-testid="waiting-text"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Amount should be displayed (symbol is rendered separately)
    await expect(
      frame.locator('[data-testid="qr-amount"]'),
    ).toHaveText('5.00');

    // QR code container should be visible
    await expect(
      frame.locator('[data-testid="qr-code"]'),
    ).toBeVisible();
  });
});
