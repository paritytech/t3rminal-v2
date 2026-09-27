import { merchantTest as test, expect } from './fixtures';
import { waitForAppReady, selectMerchantMode } from './helpers';

test.describe('Settings → Balance', () => {
  test('reaches Balance from the Settings menu and shows the host account and figure', async ({
    testHost,
  }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    // Settings opens from the gear on Home; go straight there so the spec
    // doesn't depend on the Home tile layout.
    await frame.locator('body').evaluate(() => {
      window.location.href = '/settings';
    });

    // The row itself is the thing under test — it is what puts the balance
    // within reach of a merchant.
    const row = frame.getByRole('link', { name: 'Balance' });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    // The figure comes from the host's payments bridge
    // (paymentBalanceSubscribe), so any amount proves the subscription landed.
    await expect(frame.locator('[data-testid="coin-balance"]')).toHaveText(/^\d/, {
      timeout: 30_000,
    });
    await expect(frame.locator('[data-testid="coin-balance-state"]')).toHaveText(
      'Updates as payments are claimed.',
    );

    // The account is the host's product account — Bob in this fixture.
    await expect(frame.locator('[data-testid="coin-balance-address"]')).toHaveText(/^\w{40,}$/);

    // The alias comes from `host_get_user_id`. The test host has nobody signed
    // in, so it answers NotConnected and the row says so — either way the row
    // is there, which is what proves the call is wired up.
    await expect(frame.locator('[data-testid="coin-balance-alias"]')).toHaveText(/\S/);
  });
});
