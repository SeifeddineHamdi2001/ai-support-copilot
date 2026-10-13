import { expect, test } from '@playwright/test';

/**
 * The whole copilot loop through the UI, with the mock AI providers (run in CI against the compose
 * stack): create a ticket → AI classification visible → generate a grounded draft → citations visible →
 * accept the escalation recommendation.
 */
test('create → classified → grounded draft with citations → escalation accepted', async ({
  page,
}) => {
  const subject = `Refund the duplicate Pro charge ${Date.now()}`;

  await page.goto('/tickets');
  await page.getByRole('button', { name: 'New ticket' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Customer', { exact: true }).click();
  await page.getByRole('option').first().click();
  await dialog.getByLabel('Subject').fill(subject);
  await dialog
    .getByLabel('Customer message')
    .fill('I was charged twice for my Pro plan this month. Please refund the duplicate charge.');
  await dialog.getByRole('button', { name: 'Create ticket' }).click();

  // Classification: intent and AI-set priority on the detail page, recorded on the timeline.
  await expect(page.getByTestId('ticket-subject')).toHaveText(subject);
  await expect(page.getByTestId('ai-triage').getByTestId('ai-intent')).toHaveText(/Refund/);
  await expect(page.getByTestId('priority-source')).toHaveText('Set by AI');
  const timeline = page.getByTestId('timeline');
  await expect(timeline.locator('[data-event-type="AI_CLASSIFIED"]')).toBeVisible();

  // Grounded draft: [S#] chips in the text and a source list pointing at the knowledge base.
  const panel = page.getByTestId('draft-panel');
  await panel.getByRole('button', { name: 'Generate draft' }).click();
  const content = panel.getByTestId('draft-content');
  await expect(content).toBeVisible();
  await expect(content.getByRole('button', { name: /^Source S1/ }).first()).toBeVisible();
  const sources = panel.getByTestId('draft-sources');
  await expect(sources.locator('[data-label="S1"]')).toContainText(/refund/i);
  await expect(timeline.locator('[data-event-type="DRAFT_GENERATED"]')).toBeVisible();

  // Refunds are a sensitive intent: the agent accepts the recommended escalation.
  const banner = page.getByTestId('escalation-banner');
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId('escalation-reasons')).toContainText(/refund/i);
  await banner.getByRole('button', { name: /^Escalate to / }).click();

  await expect(banner).toBeHidden();
  await expect(page.getByTestId('escalation-state')).toContainText('Escalated to');
  await expect(timeline.locator('[data-event-type="ESCALATION_ACCEPTED"]')).toBeVisible();
  await expect(timeline.locator('[data-event-type="STATUS_CHANGED"]')).toContainText('Escalated');
});
