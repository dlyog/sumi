# ChatGPT and Custom GPT integration

1StopQuantum exposes the same validated Circuit IR through two OpenAI integration
surfaces. They are separate connection modes:

- **ChatGPT App via MCP** renders a circuit and simulated counts inside ChatGPT.
- **Custom GPT Action** returns structured JSON and a browser visualization URL.

The ChatGPT App is the richer teaching experience. Custom GPT Actions are useful
when an existing GPT already uses an OpenAPI Action. A GPT uses Apps or Actions,
not both at the same time.

## 1. Start and verify the local MCP server

`make demo` starts the browser at port 8080, API at 8000, and Streamable HTTP MCP
server at 8001. To run only MCP:

```bash
make mcp
```

Local endpoint: `http://127.0.0.1:8001/mcp`

The MCP server advertises:

- Tool: `visualize_quantum_circuit(text, backend)`
- Resource: `ui://quantumyog/circuit-visualizer-v1.html`
- Backends: `qiskit` or `cirq`, both local simulation

## 2. Connect a ChatGPT App

ChatGPT cannot connect directly to `localhost`. Expose port 8001 through a
temporary, access-controlled HTTPS tunnel or deploy that service behind HTTPS.
For example, a tunnel URL such as `https://example-tunnel.invalid` maps to
`http://127.0.0.1:8001`; the MCP URL entered in ChatGPT is then:

```text
https://example-tunnel.invalid/mcp
```

In ChatGPT, enable developer mode under **Settings > Apps & Connectors >
Advanced settings**, create a connector using that HTTPS MCP URL, and add it to a
conversation. Then ask:

```text
Use 1StopQuantum to put one qubit in superposition and measure it.
```

The tool returns strict IR, generated manifest, statevector, Bloch data, and
seeded simulated counts. Its MCP App resource renders the result inline.

Do not expose this unauthenticated development endpoint permanently. A hosted
multi-user release should add OAuth and an authenticated reverse proxy.

## 3. Configure a Custom GPT Action

`integrations/custom-gpt-openapi.json` is the importable OpenAPI 3.1 document.
Expose API port 8000 through HTTPS, replace the placeholder `servers[0].url`, and
import the document in the GPT Action editor. The operation is:

```text
POST /integrations/chatgpt/visualize
operationId: visualizeQuantumCircuit
```

The Action response includes the interpretation, IR, counts, manifest, and a
`visualization_url`. Set `PUBLIC_APP_URL` to the HTTPS address serving the browser
workspace if the visualization link must work outside the local machine.

## 4. Troubleshooting

- `/health` should report `llm`, `database`, and `status` as `ok`.
- A 422 response means the request or generated IR failed validation.
- `make judge-demo` supports known deterministic prompts without a model server.
- An MCP client must use Streamable HTTP and send the tool argument as `text`.
- Every result is simulation. 1StopQuantum does not submit to a real QPU.

Official references:

- OpenAI Apps SDK quickstart: <https://developers.openai.com/apps-sdk/quickstart>
- Build an MCP server: <https://developers.openai.com/apps-sdk/build/mcp-server>
- Connect from ChatGPT: <https://developers.openai.com/apps-sdk/deploy/connect-chatgpt>
- Configure GPT Actions: <https://help.openai.com/en/articles/9442513>
