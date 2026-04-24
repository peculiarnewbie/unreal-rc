const installCommand = "npm install unreal-rc effect";

function Homepage() {
  return (
    <main class="page reference-page">
      <section class="reference-hero">
        <div>
          <p class="kicker">unreal-rc</p>
          <h1>Typed access to Unreal Remote Control from TypeScript.</h1>
          <p class="summary">
            A focused client for engineers building editor utilities, internal
            dashboards, automation scripts, and validation tools against exposed
            Unreal objects.
          </p>
        </div>
        <aside class="reference-graphic" aria-label="Remote Control API graphic">
          <div class="graphic-top">
            <span>Remote Control surface</span>
            <span>HTTP + WS</span>
          </div>
          <div class="graphic-monitor">
            <div class="graphic-crosshair" />
            <div class="graphic-chip chip-call">call()</div>
            <div class="graphic-chip chip-property">setProperty()</div>
            <div class="graphic-chip chip-batch">batch()</div>
          </div>
          <div class="graphic-code">
            <span>await</span> ue.setProperty(actorPath, "RelativeLocation", vector(100, 0, 240));
          </div>
          <div class="install-card" aria-label="Install command">
            <span>Install</span>
            <code>{installCommand}</code>
          </div>
        </aside>
      </section>

      <section class="reference-grid" aria-label="API capabilities">
        <article>
          <span>Function calls</span>
          <h2>call()</h2>
          <p>Invoke exposed Blueprint or C++ functions on a remote UObject.</p>
          <code>await ue.call(path, "ResetFixtures")</code>
        </article>
        <article>
          <span>Properties</span>
          <h2>getProperty() / setProperty()</h2>
          <p>Read and write object properties with optional transactions.</p>
          <code>await ue.setProperty(path, "Health", 100)</code>
        </article>
        <article>
          <span>Metadata</span>
          <h2>describe()</h2>
          <p>Inspect exposed properties, functions, classes, and display names.</p>
          <code>const meta = await ue.describe(path)</code>
        </article>
        <article>
          <span>Composition</span>
          <h2>batch()</h2>
          <p>Combine calls, property operations, asset searches, and raw routes.</p>
          <code>await ue.batch((b) =&gt; ...)</code>
        </article>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <>
      <style>{styles}</style>
      <Homepage />
    </>
  );
}

const styles = `
  :root {
    color-scheme: dark;
    background: #0e1114;
    color: #edf0ed;
    font-family: "Bricolage Grotesque", "Sora", sans-serif;
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
  code, pre { font-family: "IBM Plex Mono", "JetBrains Mono", monospace; }
  pre { margin: 0; overflow-x: auto; }

  .page {
    min-height: 100vh;
    padding: 34px;
    padding-bottom: 112px;
  }

  .kicker {
    margin: 0 0 18px;
    font-family: "Azeret Mono", monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .summary {
    max-width: 760px;
    margin: 20px 0 0;
    font-size: clamp(18px, 1.55vw, 23px);
    line-height: 1.42;
  }

  .reference-page {
    background:
      radial-gradient(circle at 78% 18%, rgba(191, 120, 74, 0.18), transparent 30rem),
      linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px),
      #0d1013;
    background-size: auto, 44px 44px, auto;
  }

  .reference-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(390px, 0.72fr);
    gap: 34px;
    align-items: center;
    max-width: 1260px;
    min-height: 44vh;
    margin: 0 auto;
    padding-top: 34px;
  }

  .reference-hero h1 {
    max-width: 1000px;
    margin: 0;
    font-size: clamp(38px, 5.2vw, 70px);
    line-height: 1;
    letter-spacing: -0.045em;
  }

  .reference-graphic {
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 28px;
    padding: 16px;
    background: linear-gradient(150deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.045));
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
  }

  .graphic-top {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    padding: 2px 2px 14px;
    color: rgba(237, 240, 237, 0.72);
    font-family: "Azeret Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .graphic-monitor {
    position: relative;
    height: 300px;
    overflow: hidden;
    border-radius: 20px;
    background:
      linear-gradient(120deg, rgba(191, 120, 74, 0.16), transparent 42%),
      linear-gradient(180deg, #171c22, #0d1013);
  }

  .graphic-monitor::before {
    content: "";
    position: absolute;
    inset: 24px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
  }

  .graphic-crosshair {
    position: absolute;
    inset: 50%;
    width: 134px;
    height: 134px;
    border: 1px solid rgba(217, 199, 160, 0.84);
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  .graphic-crosshair::before,
  .graphic-crosshair::after {
    content: "";
    position: absolute;
    background: rgba(217, 199, 160, 0.76);
  }

  .graphic-crosshair::before {
    top: 50%;
    left: -58px;
    width: 250px;
    height: 1px;
  }

  .graphic-crosshair::after {
    top: -58px;
    left: 50%;
    width: 1px;
    height: 250px;
  }

  .graphic-chip {
    position: absolute;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    padding: 9px 11px;
    color: #f4ead5;
    background: rgba(13, 16, 19, 0.72);
    font-family: "Azeret Mono", monospace;
    font-size: 11px;
  }

  .chip-call { top: 22%; left: 11%; }
  .chip-property { right: 10%; top: 42%; }
  .chip-batch { left: 31%; bottom: 15%; }

  .graphic-code {
    margin-top: 12px;
    border-radius: 16px;
    padding: 14px;
    overflow-x: auto;
    color: #f4ead5;
    background: #101419;
    font-family: "IBM Plex Mono", "JetBrains Mono", monospace;
    font-size: 12px;
    line-height: 1.5;
  }

  .graphic-code span { color: #9da7b3; }

  .install-card {
    margin-top: 12px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 16px;
    padding: 14px;
    background: rgba(255, 255, 255, 0.055);
  }

  .install-card span {
    display: block;
    margin-bottom: 10px;
    color: #d9c7a0;
    font-family: "Azeret Mono", monospace;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .install-card code {
    display: block;
    overflow-x: auto;
    color: #f4ead5;
  }

  .reference-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    max-width: 1260px;
    margin: 42px auto 0;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.16);
  }

  .reference-grid article {
    min-height: 310px;
    padding: 24px;
    background: #11161a;
  }

  .reference-grid span {
    display: block;
    color: #c9b386;
    font-family: "Azeret Mono", monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .reference-grid h2 {
    margin: 64px 0 14px;
    font-size: 32px;
    line-height: 1;
  }

  .reference-grid p {
    min-height: 76px;
    margin: 0 0 22px;
    color: rgba(237, 240, 237, 0.68);
    line-height: 1.45;
  }

  .reference-grid code {
    display: block;
    overflow-x: auto;
    color: #f0e8d6;
    font-size: 13px;
  }

  @media (max-width: 980px) {
    .page { padding: 22px; padding-bottom: 112px; }
    .reference-hero { grid-template-columns: 1fr; }
    .reference-graphic { max-width: 620px; }
    .reference-grid { grid-template-columns: 1fr 1fr; }
  }

  @media (max-width: 680px) {
    .page { padding: 16px; padding-bottom: 116px; }
    .reference-hero h1 { font-size: clamp(34px, 12vw, 50px); }
    .summary { font-size: 18px; }
    .graphic-monitor { height: 240px; }
    .reference-grid { grid-template-columns: 1fr; }
  }
`;
