/**
 * chisme web UI: Stage 2 placeholder.
 *
 * The browser UI is planned for Stage 2 and will talk to @chisme/server's API.
 * For now this renders a placeholder so the workspace builds and runs.
 */
export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "10vh auto", padding: "0 1rem" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>chisme</h1>
      <p style={{ color: "#666", marginTop: 0 }}>An Entire companion for searching your AI coding sessions.</p>
      <p>
        The browser UI is Stage 2. For now, use the CLI: <code>chisme search "..."</code>, or the
        HTTP API at <code>@chisme/server</code>.
      </p>
    </main>
  );
}
