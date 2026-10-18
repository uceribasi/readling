# Publishing readling

## Prepare the repository

- Choose the public repository owner and URL, then set the Git remote.
- Review the initial commit for private reading material, backups, credentials and local configuration. Do not commit real API keys or bridge tokens. Keep any example environment file free of secrets.
- Enable GitHub private vulnerability reporting and check that the reporting instructions in SECURITY.md work for the published repository.
- CI accepts pushes to main and master and all pull requests. Protect the default branch using its check job.

## Validate a release

Run from a clean checkout with Node.js 22.18 or newer:

```bash
npm ci
npm run lint
npm test
npm run build
npm audit --audit-level=moderate
```

Smoke-test text and PDF imports, a word explanation, a review, quiz answers, backup export/import, and offline reopening. Check a phone-sized screen, an RTL text and Japanese readings. Use disposable sample data and a local AI provider where possible.

## Deploy

Publish the generated dist directory to the chosen static host. For a sub-path deployment, run the build with its base path, for example:

```bash
npm run build -- --base=/readling/
```

Use HTTPS. Serve the kuromoji-dict directory with the build; Japanese readings download those files on demand. Verify the app and service worker under the actual deployment path, including an offline reload after installation.

Once the deployment is verified, add its live demo link to both READMEs. Tag the tested commit and describe the release's changes and known limitations. Repository creation, pushing and deployment need the chosen account, repository and hosting destination.
