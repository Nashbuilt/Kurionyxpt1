# Kurionyx

First-stage website prototype for Kurionyx, combining:

- a public business landing page;
- sample customer-facing product categories;
- an introductory investor page; and
- an internal stock and expense toolkit.

## Running locally

Serve the folder with any static web server, then open the local URL in a browser. No build step is required. The Supabase browser client is loaded as a pinned ES module.

The private operations toolkit uses Supabase Auth and a shared Postgres workspace. Row Level Security limits records to approved workspace members. The browser uses only the project's publishable key; never add a Supabase secret or service-role key to this repository.

The database definition used for the initial project is in `supabase/schema.sql`. Amazon, Starling, Monzo, and OpenAI remain roadmap integrations.

## Prototype status

Product information, figures, and the contact email are placeholders and should be replaced before the site is published publicly.
