# Community and Research API

The versioned read API publishes only administrator-approved records:

```text
GET  /api/v1/community/publications
POST /api/v1/community/submissions
POST /api/v1/community/submissions/{id}/deletion
```

Initial requests collect a name, email, request type, and explicit consent. The
default retention period is 24 months. Email, private feedback, moderation notes,
and raw visitor identifiers never appear in the public response. Administrators
review requests through bearer-protected endpoints; every status change creates
an audit row. Approving a contributor or reviewer assigns that role to a matching
learner account and never grants administrator access. Publication requires a
separate content, attribution, and license
review. Approved records carry their stated license; no default license is
inferred for submitted material.

The submission endpoint has an in-process rate limit of five requests per minute
per source address. Production deployments should add reverse-proxy rate limits,
request-size controls, bot detection, and abuse monitoring without retaining raw
addresses longer than necessary. The API is read-only for public research; it
does not expose a bulk user-interest or private analytics feed.

Privacy requests, including California access, correction, or deletion requests,
should go to the operator identified by the deployment's
[privacy notice](/policies.html#privacy). A submitter may also request deletion
with the returned submission ID and matching email. Database exports must exclude
email and review notes unless an authorized privacy or moderation workflow needs
them. Backups follow the same deletion and retention schedule.

Grant and research integrations should cache the versioned public feed, preserve
author attribution and licensing, link to original sources, and record any data
transformation. Consumers must honor deletion, correction, and license changes.
Breaking schema changes require a new `/api/v2` namespace.

Additional public discovery endpoints are:

```text
GET /api/v1/content/catalog
GET /api/v1/community/interests
```

The interest feed contains counts by request type only. The content catalog lists
course, use-case, podcast, documentation, and attribution metadata. Neither feed
contains contact details, private feedback, moderation notes, or visitor IDs.
