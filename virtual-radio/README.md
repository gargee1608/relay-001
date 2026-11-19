# Private Virtual Radio (MVP starter)

Self-hosted multi-room PTT starter. Includes Express authentication/API, Socket.IO floor control, LiveKit SFU (with embedded TURN), MySQL, and five seeded demo channels.

## Install

On a fresh Ubuntu Server machine, extract this folder and run:

```bash
sudo bash install.sh
```

The installer installs Docker prerequisites, creates secrets, opens required local firewall ports, and starts the stack. It does not configure a public domain or TLS certificate.

## Initial access

Open `http://SERVER-IP:3000`. The installer prints the initial admin password. That account is the super admin. Register additional accounts from the login page; they stay pending until a super admin or admin allows them from the Users panel. The five seeded rooms are `ops`, `security`, `support`, `management`, and `emergency`. Allowed accounts can join these demo rooms.

From Users, a super admin can allow a pending account, enable or disable access, remove a user, and grant or revoke admin. An admin can allow, enable, disable, and remove regular users only. The super admin account cannot be removed or disabled from the panel. Disabling or removing someone signs them out immediately.

## Important limitations before production

- This is an MVP/demo starter, not a security-audited production release.
- Configure HTTPS/WSS with a real DNS name and trusted certificate before using browser microphone access from remote devices. Browsers generally require a secure context for microphone access.
- Set `PUBLIC_LIVEKIT_URL` to the secure LiveKit endpoint, and configure LiveKit TURN TLS/domain settings and certificates for restrictive networks.
- Set a strong `ADMIN_PASSWORD` before first startup. If already initialized, change it in the database or add an admin password management feature before production.
- The sample UI uses CDN-hosted browser SDKs; vendor/pin these assets locally for air-gapped deployments.
- The five channels are demo rooms without per-room passwords by default. Admin can set one using the admin API endpoint; a dedicated admin UI is not yet included.
- The initial floor-control implementation is in-memory and single-instance. For multiple app replicas, move floor state/locking to Redis or MySQL transactions.
- Run concurrency, reconnect, audio-device, browser, security, and load tests before real-world deployment.

## Ports

- 3000/TCP: Web app/API
- 7880/TCP: LiveKit signalling
- 7881/TCP: LiveKit TCP ICE fallback
- 3478/UDP: embedded TURN
- 50000-50100/UDP: LiveKit media range

LiveKit is configured to use host networking. Adjust the media range and firewall to suit your environment.
