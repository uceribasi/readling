# Security policy

Security fixes target the latest code on the default branch and the latest release. Older releases do not receive separate security updates.

## Reporting a vulnerability

Use **Security → Advisories → Report a vulnerability** on the project's GitHub repository to report privately, when that option is available. If private reporting is unavailable, open an issue asking the maintainer for a private reporting channel, without including vulnerability details or a working exploit.

Include the affected version or commit, browser and operating system, reproduction steps, expected impact, and a minimal sample that contains no personal information. Never include API keys, bridge tokens, private reading material, or your complete browser backup.

Please allow time to investigate and prepare a fix before publishing exploit details. Response times depend on maintainer availability; there is no guaranteed response deadline.

## Security boundaries

- The app stores reading material, vocabulary and settings in the browser. JSON backups contain personal learning data and original PDF files; they exclude API keys, settings and AI caches.
- Cloud AI requests go to the provider or compatible endpoint selected in Settings. Stories and simplifications send more than a selected word; see the README's privacy section.
- The optional CLI bridge is intended for personal, local use. Keep its pairing token private and restrict its allowed origins. Do not expose it as a public service.
- Contributions run through lint, tests, a production build and an npm dependency audit in CI. An audit passing does not guarantee that the application is free of vulnerabilities.
