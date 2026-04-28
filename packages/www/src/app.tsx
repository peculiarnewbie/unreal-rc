import { highlight } from "sugar-high";

const NPM_URL = "https://www.npmjs.com/package/unreal-rc";
const GITHUB_URL = "https://github.com/peculiarnewbie/unreal-rc";
const installCommand = "npm install unreal-rc effect";

const heroSnippet = `import { UnrealRC, vector } from "unreal-rc";

const ue = new UnrealRC({
  baseUrl: "ws://localhost:30020"
});

const hero = "/Game/Level.Level:PersistentLevel.Hero";

await ue.setProperty(
  hero,
  "RelativeLocation",
  vector(100, 0, 240)
);`;

const withoutSnippet = `const ws = new WebSocket("ws://localhost:30020");
const pending = new Map();
let nextId = 1;

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  const entry = pending.get(msg.RequestId);
  if (!entry) return;
  pending.delete(msg.RequestId);
  msg.ResponseCode < 300
    ? entry.resolve(msg.ResponseBody)
    : entry.reject(new Error(\`RC \${msg.ResponseCode}\`));
});

await new Promise((r) =>
  ws.addEventListener("open", r, { once: true })
);

function send(verb, url, body) {
  const requestId = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({
      MessageName: "http",
      Parameters: { RequestId: requestId, Url: url, Verb: verb, Body: body }
    }));
  });
}

await send("PUT", "/remote/object/property", {
  ObjectPath: "/Game/Level.Level:PersistentLevel.Hero",
  PropertyName: "RelativeLocation",
  PropertyValue: { X: 100, Y: 0, Z: 240 },
  Access: "WRITE_ACCESS"
});`;

const withSnippet = `import { UnrealRC, vector } from "unreal-rc";

const ue = new UnrealRC({ baseUrl: "ws://localhost:30020" });

await ue.setProperty(
  "/Game/Level.Level:PersistentLevel.Hero",
  "RelativeLocation",
  vector(100, 0, 240)
);`;

const batchSnippet = `const results = await ue.batch((b) => {
  b.setProperty(hero, "Health", 100);
  b.setProperty(hero, "MaxHealth", 100);
  b.call(hero, "ResetStatusEffects");
});`;

const healthSnippet = `const watcher = ue.watchHealth({
  onChange: ({ healthy, latencyMs }) => {
    console.log(healthy ? \`up \${latencyMs}ms\` : "down");
  }
});`;

const hooksSnippet = `const ue = new UnrealRC({
  baseUrl: "ws://localhost:30020",
  retry: { maxAttempts: 3, delayMs: 200 },
  onRequest: ({ verb, url }) => console.debug(verb, url),
  onError: ({ url, error }) => console.error(url, error)
});`;

const quickStartSnippet = `import { UnrealRC } from "unreal-rc";

const ue = new UnrealRC({
  baseUrl: "ws://localhost:30020"
});

try {
  const result = await ue.call(
    "/Script/Engine.Default__KismetSystemLibrary",
    "PrintString",
    { InString: "Hello from unreal-rc" }
  );
  console.log(result);
} finally {
  await ue.dispose();
}`;

function Header() {
  return (
    <header class="site-header">
      <div class="site-header-inner">
        <a class="brand" href="/">
          <span class="brand-mark" aria-hidden="true" />
          <span>unreal-rc</span>
        </a>
        <nav class="site-nav">
          <a href="#get-started">Get started</a>
          <a href={NPM_URL} target="_blank" rel="noreferrer">npm</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </div>
    </header>
  );
}

function HeroGraphic() {
  return (
    <aside class="hero-editor" aria-label="unreal-rc usage example">
      <div class="editor-top">
        <span class="editor-dot" aria-hidden="true" />
        <span class="editor-filename">example.ts</span>
        <span class="editor-tag">HTTP + WS</span>
      </div>
      <pre class="editor-code">
        <code innerHTML={highlight(heroSnippet)} />
      </pre>
      <div class="editor-tooltip" aria-hidden="true">
        <div class="tooltip-head">
          <span class="tooltip-kind">method</span>
          <span>UnrealRC.setProperty</span>
        </div>
        <pre class="tooltip-sig">{`(objectPath: string,
 propertyName: string,
 propertyValue: unknown,
 options?: SetPropertyOptions
): Promise<ObjectPropertyResponse>`}</pre>
      </div>
    </aside>
  );
}

function Hero() {
  return (
    <section class="hero">
      <div class="hero-grid">
        <div class="hero-copy">
          <p class="kicker">unreal-rc</p>
          <h1>Typed access to Unreal Remote Control.</h1>
          <p class="summary">
            A focused client for building tools on top of Unreal's Remote
            Control API.
          </p>
          <div class="hero-ctas">
            <a class="cta primary" href="#get-started">Get started</a>
            <a class="cta" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </div>
          <ul class="hero-meta" aria-label="Package details">
            <li>Effect Schema</li>
            <li>HTTP + WebSocket</li>
            <li>Node 18+</li>
          </ul>
        </div>
        <HeroGraphic />
      </div>
    </section>
  );
}

function GettingStarted() {
  return (
    <section class="get-started" id="get-started" aria-labelledby="get-started-heading">
      <header class="section-head">
        <span class="section-tag">01 · Setup</span>
        <h2 id="get-started-heading">Get started in a minute</h2>
        <p>
          Install the package and point the client at an Unreal editor with the
          Remote Control API plugin enabled.
        </p>
      </header>
      <div class="get-started-grid">
        <div class="install-step">
          <span class="step-label">Install</span>
          <code class="install-line">{installCommand}</code>
          <p class="muted">
            Requires Node 18+ and the Remote Control API plugin enabled in your
            Unreal project.
          </p>
        </div>
        <pre class="code-block">
          <code innerHTML={highlight(quickStartSnippet)} />
        </pre>
      </div>
    </section>
  );
}

function Comparison() {
  return (
    <section class="comparison" aria-labelledby="comparison-heading">
      <header class="section-head">
        <span class="section-tag">02 · Why</span>
        <h2 id="comparison-heading">Skip the plumbing.</h2>
        <p>
          The Remote Control WebSocket works, but driving it by hand means
          envelope wrangling, request-id correlation, and a fresh set of bugs
          every time you add a feature. Here's the same property write, with
          and without.
        </p>
      </header>
      <div class="comparison-grid">
        <div class="comparison-col">
          <div class="col-head">
            <span class="col-label">Without</span>
            <span class="col-count">~32 lines</span>
          </div>
          <pre class="code-block comparison-code">
            <code innerHTML={highlight(withoutSnippet)} />
          </pre>
          <p class="col-note">
            And still missing: timeouts, retries, reconnection, response
            validation, types.
          </p>
        </div>
        <div class="comparison-col">
          <div class="col-head">
            <span class="col-label accent">With unreal-rc</span>
            <span class="col-count">9 lines</span>
          </div>
          <pre class="code-block comparison-code">
            <code innerHTML={highlight(withSnippet)} />
          </pre>
          <p class="col-note">
            Included: request correlation, timeouts, retries, auto-reconnect,
            schema-validated responses, full types.
          </p>
        </div>
      </div>
    </section>
  );
}

function Patterns() {
  return (
    <section class="patterns" aria-labelledby="patterns-heading">
      <header class="section-head">
        <span class="section-tag">03 · Patterns</span>
        <h2 id="patterns-heading">Beyond a single write.</h2>
        <p>
          The shapes that justify a real client — hard to get right by hand,
          one call away here.
        </p>
      </header>
      <div class="patterns-list">
        <article>
          <div class="card-meta">
            <span class="card-label">Batch</span>
            <h3>Group edits in one round-trip</h3>
          </div>
          <pre><code innerHTML={highlight(batchSnippet)} /></pre>
        </article>
        <article>
          <div class="card-meta">
            <span class="card-label">Health</span>
            <h3>Watch the editor, reconnect on drop</h3>
          </div>
          <pre><code innerHTML={highlight(healthSnippet)} /></pre>
        </article>
        <article>
          <div class="card-meta">
            <span class="card-label">Hooks</span>
            <h3>Retry, log, and redact in one place</h3>
          </div>
          <pre><code innerHTML={highlight(hooksSnippet)} /></pre>
        </article>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer class="site-footer">
      <div class="site-footer-inner">
        <span class="footer-brand">unreal-rc</span>
        <nav>
          <a href={NPM_URL} target="_blank" rel="noreferrer">npm</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <style>{styles}</style>
      <Header />
      <main class="page reference-page">
        <Hero />
        <GettingStarted />
        <Comparison />
        <Patterns />
      </main>
      <Footer />
    </>
  );
}

const styles = `
  :root {
    color-scheme: dark;
    background: #0e1114;
    color: #edf0ed;
    font-family: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
    --sh-class: #f4ead5;
    --sh-identifier: #edf0ed;
    --sh-sign: #8996a3;
    --sh-string: #d9c7a0;
    --sh-keyword: #bf784a;
    --sh-comment: #6b7580;
    --sh-jsxliterals: #f4ead5;
    --sh-property: #c9b386;
    --sh-entity: #c9b386;
  }

  * { box-sizing: border-box; }

  html, body, #app {
    min-width: 320px;
    min-height: 100%;
    margin: 0;
  }

  body {
    min-height: 100vh;
    overflow-x: hidden;
    background: #0e1114;
  }

  button, a { font: inherit; }
  a { color: inherit; text-decoration: none; }
  code, pre { font-family: "JetBrains Mono", ui-monospace, monospace; }
  pre { margin: 0; overflow-x: auto; }

  .page {
    padding: 0 34px 112px;
  }

  .reference-page {
    background:
      radial-gradient(circle at 78% 8%, rgba(191, 120, 74, 0.18), transparent 30rem),
      linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px),
      #0d1013;
    background-size: auto, 44px 44px, auto;
  }

  /* ── Header ─────────────────────────────────────────────────────────── */

  .site-header {
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(14px);
    background: rgba(13, 16, 19, 0.72);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .site-header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1260px;
    margin: 0 auto;
    padding: 16px 34px;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .brand-mark {
    width: 14px;
    height: 14px;
    border: 1.5px solid #d9c7a0;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%, #bf784a 2px, transparent 3px),
      transparent;
  }

  .site-nav {
    display: inline-flex;
    gap: 22px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .site-nav a {
    color: rgba(237, 240, 237, 0.72);
    transition: color 150ms ease;
  }

  .site-nav a:hover { color: #f4ead5; }

  /* ── Hero ───────────────────────────────────────────────────────────── */

  .kicker {
    margin: 0 0 18px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #d9c7a0;
  }

  .summary {
    max-width: 580px;
    margin: 20px 0 0;
    font-size: clamp(18px, 1.55vw, 23px);
    line-height: 1.42;
    color: rgba(237, 240, 237, 0.8);
  }

  .hero {
    max-width: 1260px;
    margin: 0 auto;
    padding-top: 56px;
  }

  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(440px, 0.95fr);
    gap: 48px;
    align-items: center;
    min-height: 48vh;
  }

  .hero-copy h1 {
    max-width: 24ch;
    margin: 0;
    font-size: clamp(38px, 4.8vw, 62px);
    line-height: 1.04;
    letter-spacing: -0.035em;
    font-weight: 600;
  }

  .hero-ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 34px;
  }

  .cta {
    display: inline-flex;
    align-items: center;
    padding: 12px 18px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #edf0ed;
    transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
  }

  .cta:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.32);
  }

  .cta.primary {
    color: #0e1114;
    background: #f4ead5;
    border-color: #f4ead5;
  }

  .cta.primary:hover {
    background: #fff5de;
    transform: translateY(-1px);
  }

  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 0;
    margin: 26px 0 0;
    padding: 0;
    list-style: none;
    color: rgba(237, 240, 237, 0.62);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .hero-meta li + li::before {
    content: "·";
    margin: 0 14px;
    color: rgba(237, 240, 237, 0.28);
  }

  /* ── Hero editor graphic ────────────────────────────────────────────── */

  .hero-editor {
    position: relative;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 20px;
    background:
      linear-gradient(150deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01));
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.38),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    overflow: visible;
  }

  .editor-top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(237, 240, 237, 0.66);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .editor-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #bf784a;
    box-shadow: 0 0 10px rgba(191, 120, 74, 0.6);
  }

  .editor-filename { color: #f4ead5; }

  .editor-tag {
    margin-left: auto;
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    color: #d9c7a0;
  }

  .editor-code {
    padding: 22px 24px 26px;
    font-size: 13.5px;
    line-height: 1.7;
  }

  .editor-code code { color: #edf0ed; }

  .editor-tooltip {
    position: absolute;
    right: -28px;
    bottom: 62px;
    max-width: 380px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 10px;
    background: rgba(20, 24, 30, 0.96);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    line-height: 1.55;
    color: #edf0ed;
  }

  .tooltip-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    color: #f4ead5;
  }

  .tooltip-kind {
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(191, 120, 74, 0.22);
    color: #bf784a;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .tooltip-sig {
    color: #c9b386;
    white-space: pre;
  }

  /* ── Get started ────────────────────────────────────────────────────── */

  .get-started {
    max-width: 1260px;
    margin: 112px auto 0;
    scroll-margin-top: 80px;
  }

  .section-head { max-width: 620px; margin-bottom: 36px; }
  .section-head h2 {
    margin: 12px 0 14px;
    font-size: clamp(28px, 3vw, 42px);
    letter-spacing: -0.035em;
    line-height: 1.05;
  }
  .section-head p {
    margin: 0;
    color: rgba(237, 240, 237, 0.7);
    font-size: 17px;
    line-height: 1.5;
  }

  .section-tag {
    display: inline-block;
    color: #c9b386;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .get-started-grid {
    display: grid;
    grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
    gap: 1px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }

  .install-step, .code-block {
    background: #11161a;
    padding: 24px;
  }

  .install-step { display: flex; flex-direction: column; gap: 14px; }

  .step-label {
    color: #d9c7a0;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .install-line {
    display: block;
    padding: 14px 16px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background: #0d1013;
    color: #f4ead5;
    font-size: 14px;
    overflow-x: auto;
  }

  .muted {
    margin: 0;
    color: rgba(237, 240, 237, 0.6);
    font-size: 13.5px;
    line-height: 1.5;
  }

  .code-block {
    padding: 22px 24px;
    font-size: 13.5px;
    line-height: 1.7;
  }

  /* ── Comparison ─────────────────────────────────────────────────────── */

  .comparison {
    max-width: 1260px;
    margin: 112px auto 0;
  }

  .comparison-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }

  .comparison-col {
    display: flex;
    flex-direction: column;
    background: #11161a;
  }

  .comparison-col:first-child { opacity: 0.78; }

  .col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .col-label {
    color: rgba(237, 240, 237, 0.66);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .col-label.accent { color: #d9c7a0; }

  .col-count {
    color: rgba(237, 240, 237, 0.42);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
  }

  .comparison-code {
    flex: 1;
    padding: 20px 22px;
    font-size: 12.5px;
    line-height: 1.65;
  }

  .col-note {
    margin: 0;
    padding: 14px 22px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(237, 240, 237, 0.58);
    font-size: 13px;
    line-height: 1.5;
  }

  /* ── Patterns ───────────────────────────────────────────────────────── */

  .patterns {
    max-width: 1260px;
    margin: 112px auto 0;
  }

  .patterns-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }

  .patterns-list article {
    display: grid;
    grid-template-columns: minmax(240px, 0.4fr) minmax(0, 1fr);
    gap: 32px;
    padding: 28px 32px;
    background: #11161a;
    align-items: center;
  }

  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card-label {
    display: block;
    color: #c9b386;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .patterns-list h3 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: #edf0ed;
  }

  .patterns-list pre {
    margin: 0;
    padding: 18px 20px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    background: #0d1013;
    font-size: 13px;
    line-height: 1.65;
    overflow-x: auto;
  }

  /* ── Footer ─────────────────────────────────────────────────────────── */

  .site-footer {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 112px;
    padding: 28px 34px;
    background: #0b0e11;
  }

  .site-footer-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1260px;
    margin: 0 auto;
    color: rgba(237, 240, 237, 0.55);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .footer-brand { color: #f4ead5; }

  .site-footer nav { display: inline-flex; gap: 22px; }
  .site-footer nav a { transition: color 150ms ease; }
  .site-footer nav a:hover { color: #f4ead5; }

  /* ── Responsive ─────────────────────────────────────────────────────── */

  @media (max-width: 1080px) {
    .editor-tooltip { display: none; }
  }

  @media (max-width: 980px) {
    .page { padding: 0 22px 112px; }
    .site-header-inner { padding: 14px 22px; }
    .hero-grid { grid-template-columns: 1fr; gap: 34px; }
    .hero-editor { max-width: 640px; }
    .get-started-grid { grid-template-columns: 1fr; }
    .comparison-grid { grid-template-columns: 1fr; }
    .patterns-list article { grid-template-columns: 1fr; gap: 16px; align-items: stretch; }
    .site-footer { padding: 24px 22px; }
  }

  @media (max-width: 680px) {
    .page { padding: 0 16px 112px; }
    .site-header-inner { padding: 12px 16px; }
    .site-nav { gap: 14px; }
    .hero { padding-top: 36px; }
    .hero-copy h1 { font-size: clamp(32px, 11vw, 44px); }
    .summary { font-size: 17px; }
    .editor-code, .code-block { font-size: 12.5px; padding: 18px; }
    .site-footer-inner { flex-direction: column; gap: 12px; align-items: flex-start; }
  }
`;
