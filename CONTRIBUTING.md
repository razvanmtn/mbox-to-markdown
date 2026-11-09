# Contributing

Thanks for considering a contribution. Razvan Muntian maintains this project and decides what is merged.

## Set up

You need Node.js 20 or newer.

```sh
npm install
npm test
npm run dev
```

`npm run dev` serves the app at http://127.0.0.1:3000. `npm test` runs the Node test suite. `npm run build` writes the static app to `dist/`.

## Propose a change

1. Open an issue or comment on an existing one before a large change, so the work matches what the project needs.
2. Fork the repository and create a branch for your change.
3. Keep the change focused on one thing.
4. Add or update tests when the change affects parsing, conversion, file names, or export.
5. Run `npm test` before you open the pull request.

Do not commit a real mailbox. `.gitignore` ignores `*.mbox` except the fixture at `test/fixtures/sample.mbox`. Pull requests must not include personal mail, attachments, or private mailbox files.

## Report a problem

Use [GitHub issues](https://github.com/razvanmtn/mbox-to-markdown/issues) for bugs and feature requests. Report security vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not in a public issue.

This project follows the [code of conduct](CODE_OF_CONDUCT.md).
