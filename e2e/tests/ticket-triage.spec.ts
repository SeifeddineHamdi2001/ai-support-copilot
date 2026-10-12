import { expect, test } from '@playwright/test';

/**
 * Core triage loop with the mock AI provider: create a ticket in the UI, see it classified, change its
 * status, and see the audit timeline follow.
 */
test('create → classified → status change → timeline', async ({ page }) => {
  const subject = `Refund for duplicate charge ${Date.now()}`;

  await page.goto('/tickets');
  await page.getByRole('button', { name: 'New ticket' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Customer', { exact: true }).click();
  await page.getByRole('option').first().click();
  await dialog.getByLabel('Subject').fill(subject);
  await dialog
    .getByLabel('Customer message')
    .fill('I was charged twice for my October invoice. Please refund the duplicate payment.');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();

  // Lands on the detail page with the AI classification applied.
  await expect(page.getByTestId('ticket-subject')).toHaveText(subject);
  const triage = page.getByTestId('ai-triage');
  await expect(triage.getByTestId('ai-intent')).toHaveText(/Refund|Billing/);
  await expect(page.getByTestId('priority-source')).toHaveText('Set by AI');

  const timeline = page.getByTestId('timeline');
  await expect(timeline.locator('[data-event-type="CREATED"]')).toBeVisible();
  await expect(timeline.locator('[data-event-type="AI_CLASSIFIED"]')).toBeVisible();

  // Change status; the timeline gains a STATUS_CHANGED entry.
  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: 'In progress' }).click();
  await expect(page.getByText('Status changed to In progress')).toBeVisible();
  await expect(timeline.locator('[data-event-type="STATUS_CHANGED"]')).toContainText(
    'changed status from Open to In progress',
  );

  // The new ticket shows up in the inbox list.
  await page.getByRole('link', { name: 'Inbox' }).first().click();
  await expect(page.getByRole('link', { name: subject })).toBeVisible();
});

test('stale version shows the conflict notice and reload recovers', async ({ page, request }) => {
  await page.goto('/tickets');
  await page.getByTestId('ticket-row').first().getByRole('link').click();
  await expect(page.getByTestId('ticket-subject')).toBeVisible();

  // Someone else changes the ticket behind this page's back.
  const id = page.url().split('/').pop()!;
  const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:3001/api/v1';
  const agents = (await (await request.get(`${apiUrl}/agents`)).json()) as { id: string }[];
  const ticket = (await (await request.get(`${apiUrl}/tickets/${id}`)).json()) as {
    version: number;
    priority: string;
    intent: string | null;
  };
  const res = await request.patch(`${apiUrl}/tickets/${id}`, {
    headers: { 'X-User-Id': agents[1].id },
    data: { version: ticket.version, priority: ticket.priority === 'URGENT' ? 'LOW' : 'URGENT' },
  });
  expect(res.ok()).toBeTruthy();

  await page.getByLabel('Intent').click();
  await page.getByRole('option', { name: ticket.intent === 'OTHER' ? 'General' : 'Other' }).click();
  await expect(page.getByText('This ticket was updated by someone else')).toBeVisible();

  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByText('This ticket was updated by someone else')).toBeHidden();
});
