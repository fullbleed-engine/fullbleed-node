# Fullbleed PDF downloads in Next.js

A runnable App Router starter that serves a designed invoice from a Node.js
route. It includes the HTML/CSS, an actual PDF preview, and an isolated
standalone-server check. All invoice data is fictional; the public fixture
lookup is not an authentication system.

## Run it

Use Node.js 22 or newer. From this directory:

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Open `http://127.0.0.1:3000` and select **Download sample PDF**. The route
`/api/invoices/NS-1042` returns the one-page invoice as an attachment. Unknown
IDs return 404. Use `npm run dev` while editing the app. `PORT` changes the port;
`FULLBLEED_HOST` changes the production server's loopback binding.

The lockfile pins Next.js 16.3.8, React 19.3.0 and Fullbleed Node 0.1.5
(engine 2.5.8) from npm. The registry package is byte-identical to the
verified GitHub release tarball.
Installing this starter needs no Python, Rust, system fonts or browser renderer.

## Adapt the document

Edit `templates/invoice.html` and `templates/invoice.css`. The sample uses
bundled Inter, DM Serif Display and Bebas Neue. `lib/invoice.mjs` inserts an
escaped customer name from the fictional fixture. Amounts and dates are sample
content, not an invoicing ledger or tax calculation.

After changing the template, regenerate and inspect the PDF and preview:

```sh
npm run preview:pdf
```

Open `output/invoice.pdf` and `public/invoice.png`, then rebuild the app. The
checked-in image is output from Fullbleed, not a browser screenshot or mockup.

## Keep the renderer on the server

The route declares `runtime = 'nodejs'`. It uses filesystem reads, worker
threads and WebAssembly, so this integration needs the Node runtime.
`serverExternalPackages: ['fullbleed']` keeps Next.js from bundling the engine's
Node entrypoint. Explicit output tracing includes the worker, WASM, fonts,
WASI dependency and template files needed by the standalone server.
See Next.js's [external-package configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)
and [standalone output documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

`npm run build` copies the public preview and browser chunks into
`.next/standalone`, after Next generates it. That folder is the deployment
artifact. Start its `server.js` with Node on a host that supports workers and
WebAssembly; set the host's normal `PORT` and `HOSTNAME` environment variables.
The local start script defaults to loopback. Hosting-provider limits and
serverless or Edge deployments have not been verified by this starter.

## Adapt the route for real accounts

Replace `getDemoInvoice(id)` with a session-authenticated lookup that verifies
the invoice belongs to that account **before rendering**. Keep order fields
escaped. Never accept arbitrary HTML, filesystem paths or remote asset URLs
from this public endpoint.

The example renders at most one document at a time per server process. Extra
requests receive `503 BUSY` and `Retry-After: 2`; they do not enter an unbounded
queue. Successful PDFs have `private, no-store`, a fixed filename, a complete
content length and `nosniff`. Jobs have a 15-second rendering deadline and a
five-page cap, and receive the request's abort signal. No generated PDF is
written to application storage by the route.

The render promise waits for its worker to exit, including after errors,
timeouts, or cancellation. The route therefore holds its capacity slot until
that worker stops; sequential downloads do not overlap worker lifetimes.

Use shared rate/usage controls for multiple processes or replicas. Measure your
host's memory and CPU before increasing capacity; each render worker can grow
to the package's 512 MiB WASM ceiling. Private document delivery also requires
your application's normal access controls, monitoring and retention policies.

## Verify the production artifact

After building:

```sh
npm run verify
```

The check copies the standalone artifact to a fresh temporary directory outside
the app and starts it on an available loopback port. It compares a real HTTP
PDF to the direct engine output, checks headers and missing IDs, sends a
concurrent burst, then verifies recovery from actual missing-glyph and page-cap
failures. Client JavaScript is checked for accidental engine/worker inclusion.
Results and the downloaded PDF are retained under `output/`.

Temporary artifact directories use the `fullbleed-nextjs-` prefix and are kept
for inspection. The verification script closes its own server when it finishes.
These checks cover a fictional fixture; they do not establish application
authorization, PDF standards compliance, or a hosting provider's limits.

[Fullbleed Node API](https://github.com/fullbleed-engine/fullbleed-node) ·
[Documentation](https://docs.fullbleed.dev/) · [MIT license](LICENSE)
