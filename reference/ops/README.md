# ops — examples

Example deployment on one Linux host, as it runs for the authors; adapt paths and names.

- `systemd/embassy-web.service`: the site on 127.0.0.1:3910, database read-only, no API key.
- `systemd/embassy-run.service` and `.timer`: three runs a day (06:00, 14:00, 22:00 UTC), with a call and time
  budget; the only unit that reads the model key (`EnvironmentFile`, mode 600, owned by the service user).
- `systemd/embassy-maintain.service` and `.timer`: hourly alert check and a daily database backup (14 kept).
- `Caddyfile`: TLS, Basic authentication on the whole site while it is private, and `/metrics` behind its own
  credentials; Caddy marks requests that passed them, and the app serves Metrics only with that mark. Create
  password hashes with `caddy hash-password`.

Run the service as its own system user with no shell; keep the code read-only for it and the data directory
writable.
