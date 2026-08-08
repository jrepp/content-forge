// Shared CDP client: evaluate one expression in the running Blockbench renderer.
// Node 24 built-in fetch + WebSocket; a hard timeout so a hung/closed renderer
// never wedges a producer.
export async function cdpEval(expr, { port = 9223, timeoutMs = Number(process.env.FORGE_CDP_TIMEOUT_MS || 60000) } = {}) {
	const list = await fetch(`http://localhost:${port}/json/list`).then((r) => r.json());
	const page = list.find((t) => t.type === 'page');
	if (!page) throw new Error(`no Blockbench page target on :${port} (launch with BLOCKBENCH_AUTOMATION=1)`);
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0; const pending = new Map();
	const send = (method, params) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((res) => pending.set(mid, res)); };
	let timer;
	try {
		return await Promise.race([
			new Promise((resolve, reject) => {
				ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m); });
				ws.addEventListener('error', (e) => reject(new Error('WS ' + (e.message || e))));
				ws.addEventListener('close', () => reject(new Error('CDP socket closed before the eval returned')));
				ws.addEventListener('open', async () => {
					try {
						await send('Runtime.enable');
						const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
						if (r.result && r.result.exceptionDetails) throw new Error('PAGE ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
						resolve(r.result.result.value);
					} catch (e) { reject(e); }
				});
			}),
			new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP eval timed out after ${timeoutMs}ms`)), timeoutMs); }),
		]);
	} finally {
		clearTimeout(timer);
		try { ws.close(); } catch { /* already closing */ }
	}
}
