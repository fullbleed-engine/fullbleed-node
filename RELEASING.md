# Releasing the Node package

The package version is separate from the pinned Fullbleed engine version.
Keep `package.json`, the adapter version in `engine/Cargo.toml`, and both
lockfiles synchronized when changing their respective versions.

1. Build and verify locally using the README commands. Inspect generated PDFs
   and their finalized previews. Keep the original inputs and reports. Run the
   [installed font checks](docs/font-subsets.md), including the previous-release
   comparison, and retain the source fonts with their licenses.
2. Commit the candidate and run the full Node integration workflow. Require all
   ten jobs to pass. All nine platform/Node combinations must install the same
   `node-package` artifact; do not rebuild the tarball for publication.
3. Retain workflow logs, the native comparison report, and every installed-package
   report. Compare their fixture PDF/PNG hashes and package integrity values.
4. Download `node-package` and check its npm SHA-512 integrity against
   `package-info.json`. Review the 18-file package allowlist and included notices.
5. Tag the exact tested commit as `v<package-version>`. Create a draft GitHub
   release with the unchanged tarball, verification summary, evidence archive,
   and SHA-256 sums. Verify uploaded sizes and hashes before publishing.
6. Install the public GitHub tarball in a new directory and render the quickstart
   again. Confirm that its PDF and PNG hashes match the retained fixture.
7. Run `publish-npm.yml` from `main` with the version, its successful Node
   integration run ID, and `publish=false`. It requires the public release,
   annotated tag/source commit, all ten CI jobs, package metadata, and tarball
   hashes to agree. Then dispatch the same inputs with `publish=true` to publish
   the unchanged tarball through npm's GitHub trusted publisher. Do not repack it.
8. Verify registry metadata, tarball integrity, and a fresh registry install.
   Read the emitted PDF with the independent extraction check before updating
   version pins in examples and documentation.

The repository's `npm run verify:text` check requires the test-only Python reader
`pypdf==6.19.0`. It reads the actual PDF from `npm run verify:pack` and checks its
hash and single-copy authored text. The font comparison also uses the pinned
PDFium, fonttools, and Pillow versions in CI. These are not package dependencies.

Configure npm's trusted publisher for organization `fullbleed-engine`, repository
`fullbleed-node`, workflow `publish-npm.yml`, and environment `npm`, allowing direct
`npm publish`. The publication job receives OIDC access only after verification;
it uses no stored npm token. See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

The checks establish package behavior for the retained fixtures. They do not
establish PDF standards certification, general browser parity, or arbitrary
document performance guarantees.
