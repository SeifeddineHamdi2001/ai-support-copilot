---
title: Password Reset and Two-Factor Authentication
slug: password-reset-2fa
category: account-access
---

# Password Reset and Two-Factor Authentication

How customers regain access to their Acme Cloud account.

## Resetting a password

Click "Forgot password" on the login page and enter the account email. Acme Cloud sends a reset link that
expires after 30 minutes. Only the most recent link works; requesting a new link cancels the previous ones.

### The reset email does not arrive

1. Check the spam or junk folder, and search for mail from no-reply@acmecloud.example.
2. Wait 10 minutes: requesting several links in a row can delay delivery.
3. Ask the IT team to allow mail from acmecloud.example; corporate filters often quarantine reset emails.
4. If the account uses SSO, the password is managed by the identity provider, and Acme Cloud does not send
   reset emails. Sign in with the SSO button instead.

If none of these work, support can confirm the email address on the account and trigger a reset manually
after verifying the requester's identity.

## Two-factor authentication (2FA)

Acme Cloud supports authenticator apps (TOTP) and hardware security keys. When 2FA is enabled, the user
receives 10 single-use backup codes. Each backup code works once.

### Lost 2FA device

If the user still has a backup code, they can sign in with it and then set up 2FA on a new device under
Settings > Security.

Without backup codes, an account admin of the same organisation can reset 2FA for the user from
Admin > Members. If the locked-out user is the only admin, support must verify identity before removing
2FA: the request must come from the account email, and the user must confirm the last 4 digits of the card
on file and the date of the last invoice. Identity verification takes up to 2 business days. Support never
removes 2FA based on a chat conversation alone.
