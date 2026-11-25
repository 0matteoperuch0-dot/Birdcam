# BirdCam cloud sharing — development branch only

The production `main` branch is unchanged. **This feature is not yet online**.

## What is implemented
- Private email/password account login (Supabase Auth REST).
- Copy of JPEG captures from the iPad IndexedDB archive to a private Storage bucket.
- Retry every 15 seconds while the BirdCam page remains active, after reconnection.
- Cloud photo gallery accessible by logging in from another device.
- Original local files preserved; no deletion and no videos uploaded.
- No push notifications yet. No quota enforcement yet.

## Required setup before release
1. Create a **separate** Supabase project for BirdCam. Never reuse SpesaFacile production.
2. Enable email/password authentication and create the intended user.
3. Run `supabase/setup.sql` within this new BirdCam project, then inspect bucket privacy and access policies.
4. Put only the project's public URL and `sb_publishable_...` key in `cloud-config.js`. NEVER embed a service_role or secret API key.
5. Test sign in, actual photo upload, gallery download, reconnect retries, and authorization isolation.
6. Test on iPad Air 2 with Safari (iPadOS 15) before merging to `main`.
7. Implement push notifications (with per-event rate limit) and storage retention in a separate change.

## Current limitations
- Nothing can be uploaded from the **already running** Safari page until it is refreshed/reopened with the new version.
- The current device must remain awake, with Safari in foreground, to capture and sync.
- Sync state is tracked in localStorage per device; clearing site data can reset this index and may cause retries to conflict with existing uploaded paths.
- Signed image links are valid for 10 minutes, after which the remote gallery must be refreshed.
- The gallery currently shows up to 100 newest photos; pagination is pending.
- A new Supabase project may have billing implications; do not create it before cost review.
