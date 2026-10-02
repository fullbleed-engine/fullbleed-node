# Releasing the Node package

The package version is separate from the pinned Fullbleed engine version.
Keep `package.json`, the adapter version in `engine/Cargo.toml`, and both
lockfiles synchronized when changing their respective versions.

1. Build and verify locally using the README commands. Inspect generated PDFs
   and their finalized previews. Keep the original inputs and reports.
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

Until npm account publishing is configured, document the versioned GitHub
tarball installation URL. Do not advertise `npm install fullbleed` as a registry
installation. If publishing to npm, publish the exact verified tarball, then
verify registry metadata and a fresh registry install before updating that command.

The checks establish package behavior for the retained fixtures. They do not
establish PDF standards certification, general browser parity, or arbitrary
document performance guarantees.
