# Google Calendar integration — setup that does not get blocked

The Interviews page reads your Google Calendar through an OAuth client you own in Google
Cloud. This file explains how to set that client up so Google does not disable it, and what
to do if it ever happens anyway.

## What the app asks for, and why

| Scope | Why |
|---|---|
| `calendar.events.readonly` | read the events shown on the Interviews page |
| `calendar.calendarlist.readonly` | know which calendars to read them from |
| `userinfo.email` | show which Google account is connected |

Nothing is ever written to your calendar, and no other Google data is touched. We ask for
these three deliberately instead of the broad `calendar.readonly`: a narrower request is
easier to get through verification, and shows the user a smaller, truthful consent screen.

If a connection cannot read the calendar list, the sync falls back to the **primary**
calendar instead of failing — that is where interview invitations arrive.

## Setting the client up so it stays alive

In [console.cloud.google.com](https://console.cloud.google.com), with the project selected:

1. **APIs & Services → Library → Google Calendar API → Enable.** A disabled API looks like
   an auth failure and is the most common self-inflicted outage.
2. **Google Auth Platform → Branding**: fill in app name, user-support email, developer
   contact email, and the authorized domain of your dashboard. An incomplete consent screen
   is the usual reason a verification review is refused.
3. **Audience**: pick one and stay there.
   - **Testing** (recommended for personal use) — add your own Google account under *Test
     users*. No verification, no review, nothing for Google to refuse. The one cost is that
     refresh tokens expire after **7 days**, so you press *Import* again about weekly; the
     app detects this and asks you to reconnect rather than failing silently.
   - **In production** — needed for other people to use it, and this is where apps get
     blocked: with sensitive scopes it requires verification, and an app that sits
     unverified (or fails the review) can have its client disabled.
4. **Clients → Create client → Web application**:
   - Authorized redirect URI: `https://<your-api-host>/api/calendar/google/callback` —
     exact, no trailing slash. Add `http://localhost:3999/api/calendar/google/callback`
     for local work.
   - Authorized JavaScript origins: your dashboard origin.
5. Put the client id and secret in the API's environment (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, optionally `GOOGLE_REDIRECT_URI`) and redeploy.

Two more things that keep a project healthy: **do not delete and recreate the project**
(deleted projects disable every client inside them, and the id is gone for good), and
**keep using it** — an OAuth client with no activity for months can be cleaned up
automatically.

## If Google blocks the client anyway

You will see *"Access blocked: Authorization Error — The OAuth client was disabled.
Error 401: disabled_client"* on Google's own page, before the browser ever comes back to
the app.

Nothing in this codebase can prevent that: it is a decision made about your Google Cloud
project, not a request the app sends. What the app does do:

- **Says so plainly.** The Interviews page shows that Google rejected *the server's client*,
  not your account, and lists the client id and redirect URI the server is actually using so
  you can match them against the console. Sync requests answer `503` with that explanation
  instead of pushing you around the sign-in loop again.
- **Stops hammering Google.** The 5-minute auto-sync pauses as soon as Google rejects the
  client, and probes again at most once an hour — rather than a failing token request per
  user every five minutes, forever.
- **Recovers by itself.** Point the environment variables at a working client (or re-enable
  the old one) and the next successful call clears the pause. Changing `GOOGLE_CLIENT_ID`
  clears it immediately. No code change, no redeploy beyond the env update.

To recover: check **Google Auth Platform → Clients** for the client (restore it if it is in
the deleted list), or create a new one as above and update the two environment variables.
Also confirm the project itself is not pending deletion under **IAM & Admin → Manage
resources**.
