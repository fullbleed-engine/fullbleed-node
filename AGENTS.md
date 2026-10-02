# Fullbleed Node integration

This optional Node package wraps the published Fullbleed Rust crate in WebAssembly.
Keep the core engine dependency pinned and unchanged. Do not add Python, a browser,
system fonts, a system PDF stack, or AI-vendor coupling to the package.

The packed npm tarball is the installation surface. Build from Cargo.lock, test
real rendering and failure recovery, install and test the tarball in isolation,
and retain PDF/PNG evidence before publishing. Keep generated dist files out of
source control; tools/build.mjs records the actual engine and artifact hashes.

Keep claims scoped to verified fixtures and supported API options. Ordinary PDF
generation is not a PDF/UA, PDF/A, or PDF/X conformance claim.
