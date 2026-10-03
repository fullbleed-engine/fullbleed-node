// SPDX-License-Identifier: MIT
export default function Page() {
  return <>
    <header className="nav"><a className="wordmark" href="https://www.fullbleed.dev/">fullbleed<span>.</span></a><span className="eyebrow">NEXT.JS STARTER</span></header>
    <main>
      <section className="hero">
        <div className="intro">
          <p className="eyebrow">A SMALL ROUTE. A BETTER DOCUMENT.</p>
          <h1>Make the download<br /><em>worth opening.</em></h1>
          <p className="lede">Serve a designed PDF from your Next.js app. Start with this studio invoice, then make the HTML and CSS your own.</p>
          <a className="button" href="/api/invoices/NS-1042" download>Download sample PDF <span aria-hidden="true">↗</span></a>
          <p className="caption">One page · Fictional invoice NS-1042 · No sign-in</p>
          <div className="note"><span>YOUR APP. YOUR DOCUMENTS.</span><p>The PDF is generated on your Node.js server with bundled fonts. Your HTML and CSS define the printed page.</p></div>
        </div>
        <figure className="paper"><img src="/invoice.png" width="794" height="1123" alt="Actual Fullbleed PDF: a Northstar Studio invoice with cream paper, green tables, oversized type and an orange accent." /><figcaption>Actual PDF output · Northstar Studio</figcaption></figure>
      </section>
      <section className="steps" aria-label="Make it your own">
        <article><span>01 / DESIGN</span><h2>Keep your HTML &amp; CSS.</h2><p>Edit the included template. Use the bundled typefaces or supply your own font files.</p></article>
        <article><span>02 / CONNECT</span><h2>Use your application data.</h2><p>The sample route looks up a fictional invoice. Connect your own authorized record lookup when adapting it.</p></article>
        <article><span>03 / DELIVER</span><h2>Send a real PDF.</h2><p>A normal download link calls the server route. Rendering has a page limit, deadline and capacity limit.</p></article>
      </section>
    </main>
    <footer><span>Fullbleed · MIT licensed</span><a href="https://docs.fullbleed.dev/getting-started/node/">Node.js guide</a><a href="https://github.com/fullbleed-engine/fullbleed-node/tree/main/examples/nextjs">Explore the source</a></footer>
  </>;
}
