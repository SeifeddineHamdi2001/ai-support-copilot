---
title: Single Sign-On (SSO) Setup
slug: sso-setup
category: account-access
---

# Single Sign-On (SSO) Setup

Acme Cloud supports single sign-on so that teams manage access from their identity provider.

## Availability

SSO is available on the Business and Enterprise plans. Starter and Pro plans must upgrade to Business to
enable SSO. Acme Cloud supports SAML 2.0 and OpenID Connect (OIDC).

Tested identity providers: Okta, Microsoft Entra ID (Azure AD), Google Workspace and OneLogin. Any SAML 2.0
compliant provider should work.

## Setting up SAML with Okta

1. In Acme Cloud, open Admin > Security > Single sign-on and choose "SAML 2.0". Copy the ACS URL and the
   Entity ID shown on the page.
2. In Okta, create a new SAML 2.0 app integration and paste the ACS URL and Entity ID.
3. Set the Name ID format to EmailAddress and map the attributes email, firstName and lastName.
4. Download the Okta metadata XML and upload it in Acme Cloud.
5. Click "Test connection" before enforcing SSO.

The full guide is at docs.acmecloud.example/sso.

## Enforcing SSO

After a successful test, admins can enforce SSO so that members can only sign in through the identity
provider. Keep at least one admin with a password login as a break-glass account in case the identity
provider is unavailable.

## User provisioning (SCIM)

Enterprise plans include SCIM 2.0 provisioning: users created or removed in the identity provider are
created or deactivated in Acme Cloud automatically. Business plans use just-in-time provisioning: a member
is created at their first SSO sign-in.
