---
title: Outage and Incident Procedure
slug: outage-procedure
category: technical
---

# Outage and Incident Procedure

What support does when customers report that Acme Cloud is down, slow, or returning errors.

## Check the status page first

The live status of every Acme Cloud component (dashboard, API, data pipeline, exports) is published at
status.acmecloud.example. Before troubleshooting an individual account, check whether an incident is
already open. Customers can subscribe to status updates by email or webhook from the same page.

## When customers report errors

If many customers report 500 errors or timeouts at the same time, treat it as a possible outage:

1. Check the status page and the #incidents channel.
2. If no incident is open, page the on-call engineer and open an incident with the error messages, times
   (in UTC) and affected accounts.
3. Reply to the customer with the incident link and tell them updates are posted at least every 30 minutes
   until the incident is resolved.

Do not promise a resolution time that engineering has not confirmed.

## Communication during an incident

Status page updates are posted every 30 minutes during a major incident. Support links tickets about the
same problem to the incident so every affected customer is notified when it is resolved. A post-incident
report is published within 5 business days for major incidents.

## Service credits

Service credits apply when monthly uptime falls below the commitment in the SLA. Credits are not automatic:
the customer must request them within 30 days after the end of the affected month. Credits are applied to
the next invoice and are not paid out as cash. See the SLA document for the uptime commitment and credit
percentages.
