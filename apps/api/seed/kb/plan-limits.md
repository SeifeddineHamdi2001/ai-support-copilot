---
title: Plans and Limits
slug: plan-limits
category: product
---

# Plans and Limits

Acme Cloud has four plans: Starter, Pro, Business and Enterprise.

## Seats and storage

| Plan       | Price (monthly) | Seats     | Storage |
| ---------- | --------------- | --------- | ------- |
| Starter    | $9 per month    | 3         | 10 GB   |
| Pro        | $29 per month   | 10        | 100 GB  |
| Business   | $99 per month   | 50        | 1 TB    |
| Enterprise | Custom          | Unlimited | Custom  |

Annual billing gives two months free on every plan.

## API rate limits

API requests are limited per organisation, per minute:

- Starter: 60 requests per minute.
- Pro: 300 requests per minute.
- Business: 1,000 requests per minute.
- Enterprise: custom limits agreed in the contract.

Requests above the limit receive HTTP 429 with a Retry-After header. Business customers can request a
temporary limit increase of up to 2x for a migration or launch by contacting support at least 3 business
days in advance. Permanent increases above the Business limit require the Enterprise plan.

## Export limits

CSV exports from Reports are limited to 10,000 rows per file on Starter. Pro, Business and Enterprise have
no row limit on CSV exports.

## Changing plans

Upgrades take effect immediately and the price difference is prorated on the next invoice. Downgrades take
effect at the end of the current billing period.
