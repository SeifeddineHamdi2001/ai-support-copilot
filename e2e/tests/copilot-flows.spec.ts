import { expect, test, type APIRequestContext } from '@playwright/test';

/** Phase 7 flows through the UI only, with the mock AI providers: drafts, escalation, knowledge base. */
const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api/v1';

async function newTicket(request: APIRequestContext, subject: string, body: string) {
  const customers = (await (await request.get(`${API}/customers?limit=100`)).json()) as {
    items: { id: string; tier: string }[];
  };
  const customer = customers.items.find((c) => c.tier === 'STANDARD') ?? customers.items[0];
  const res = await request.post(`${API}/tickets`, {
    data: { customerId: customer.id, subject, body, channel: 'EMAIL' },
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

test('grounded draft: generate, inspect a source, approve without markers', async ({
  page,
  request,
}) => {
  const id = await newTicket(
    request,
    `Charged twice ${Date.now()}`,
    'I was charged twice for my Pro plan this month. Please refund the duplicate charge.',
  );
  await page.goto(`/tickets/${id}`);

  const panel = page.getByTestId('draft-panel');
  await panel.getByRole('button', { name: 'Generate draft' }).click();
  const content = panel.getByTestId('draft-content');
  await expect(content).toBeVisible();

  // [S1] renders as a chip; clicking it opens the matching source with its full chunk.
  await content
    .getByRole('button', { name: /^Source S1/ })
    .first()
    .click();
  const source = panel.getByTestId('draft-sources').locator('[data-label="S1"]');
  await expect(source.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(source.getByRole('link', { name: 'Open document' })).toBeVisible();

  await panel.getByRole('button', { name: 'Approve and add reply' }).click();
  await expect(page.getByText('Reply added to the conversation')).toBeVisible();
  await expect(panel.getByTestId('draft-review-state')).toContainText('Approved');

  // The customer's copy has no [S#] markers.
  const reply = page.locator('ol li').filter({ hasText: 'Reply' }).last();
  await expect(reply).toBeVisible();
  await expect(reply).not.toContainText('[S1]');
  await expect(
    page.getByTestId('timeline').locator('[data-event-type="DRAFT_APPROVED"]'),
  ).toBeVisible();
});

test('no grounded answer shows the manual-review state', async ({ page, request }) => {
  const id = await newTicket(
    request,
    `Weekend plans ${Date.now()}`,
    'Any good restaurant tips near the Louvre and will it rain in Paris on Saturday?',
  );
  await page.goto(`/tickets/${id}`);
  const panel = page.getByTestId('draft-panel');
  await panel.getByRole('button', { name: 'Generate draft' }).click();
  await expect(panel.getByTestId('no-grounded-answer')).toContainText('No grounded answer');
  await expect(panel.getByTestId('draft-sources')).toHaveCount(0);
});

test('escalation banner: accept moves the ticket to Escalated', async ({ page, request }) => {
  const id = await newTicket(
    request,
    `Data breach ${Date.now()}`,
    'URGENT: we think our account was hacked and customer data leaked. Our lawyer is involved.',
  );
  await page.goto(`/tickets/${id}`);

  const banner = page.getByTestId('escalation-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId('escalation-reasons').locator('li').first()).toBeVisible();
  await banner.getByRole('button', { name: /^Escalate to / }).click();

  await expect(banner).toBeHidden();
  await expect(page.getByTestId('escalation-state')).toContainText('Escalated to');
  await expect(
    page.getByTestId('timeline').locator('[data-event-type="ESCALATION_ACCEPTED"]'),
  ).toBeVisible();
});

test('knowledge base: add a document, find it with the search tester, delete it', async ({
  page,
}) => {
  const stamp = Date.now();
  const title = `Gift cards ${stamp}`;
  await page.goto('/kb');
  await page.getByRole('button', { name: 'Add document' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Add document' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Category').fill('billing');
  await dialog.getByLabel('Slug').fill(`gift-cards-${stamp}`);
  await dialog
    .getByLabel('Content')
    .fill(
      `# ${title}\n\n## Redeeming\n\nZorblax gift cards are redeemed from Settings > Billing > Redeem code. ` +
        'A Zorblax code can be used once and never expires.',
    );
  await dialog.getByRole('button', { name: 'Add and index' }).click();

  // Opens the new document's chunks.
  await expect(page.getByTestId('kb-chunks')).toContainText('Zorblax gift cards are redeemed');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/kb$/);

  await page.getByLabel('Query').fill('How do I redeem a Zorblax gift card?');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hit = page.getByTestId('kb-hit').filter({ hasText: title }).first();
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('sim');
  await expect(hit).toContainText('rrf');

  // A hit opens its chunk; closing it keeps the search results.
  await hit.click();
  await expect(page.getByTestId('kb-chunks').locator('[aria-current="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hit).toBeVisible();

  const row = page.getByTestId('kb-row').filter({ hasText: title });
  await row.getByRole('button', { name: `Delete ${title}` }).click();
  await row.getByRole('button', { name: `Confirm delete ${title}` }).click();
  await expect(row).toHaveCount(0);
});
