import { createServer, type Server } from "node:http";

/**
 * A tiny local site for the browser tests. Nothing here reaches the internet: the one "external"
 * address (169.254.169.254) is cloud metadata, which the computer must refuse before any request.
 */
const PAGES: Record<string, string> = {
  "/form": `<!doctype html><title>Form</title>
    <h1>Order</h1>
    <label>Name <input id="name" value="Ada"></label>
    <label>Password <input type="password" value="hunter2"></label>
    <label>Code <input autocomplete="one-time-code" value="424242"></label>
    <label>Size <select id="size"><option>Small</option><option>Large</option></select></label>
    <label><input type="checkbox" id="bacon"> Bacon</label>
    <button id="save" onclick="document.getElementById('out').textContent = 'Saved: ' + document.getElementById('name').value + ', ' + document.getElementById('size').value + (document.getElementById('bacon').checked ? ', bacon' : '')">Save</button>
    <p id="out"></p>
    <form onsubmit="event.preventDefault(); document.getElementById('found').textContent = 'Searched: ' + this.q.value"><input name="q" aria-label="Search"></form>
    <p id="found"></p>
    <a href="/next">Next page</a>
    <a href="/next" target="_blank">Open in a new tab</a>`,
  "/next": `<!doctype html><title>Next</title><h1>Next page</h1><button>Continue</button>`,
  "/checkout": `<!doctype html><title>Checkout</title>
    <form onsubmit="event.preventDefault(); document.getElementById('placed').textContent = 'Order placed'">
      <label>Promo code <input id="promo"></label>
      <label>Passwort <input type="password" id="pw"></label>
      <input type="password" id="bare">
      <button type="button">Apply</button>
      <button>Place order</button>
      <button>Save for later</button>
      <div role="menuitem" tabindex="0">Remove item</div>
    </form>
    <p id="placed"></p>
    <form><label>Coupon <input id="coupon"></label><button style="display:none">Redeem</button></form>
    <button>Help</button>
    <input aria-hidden="true" style="width:0;height:0;border:0;padding:0">`,
  "/framed": `<!doctype html><title>Framed</title><h1>Pay</h1><button>Back to shop</button>
    <iframe src="/checkout" title="Payment" width="800" height="400"></iframe>`,
  "/rename": `<!doctype html><title>Rename</title>
    <button id="target">Next</button>
    <button onclick="setTimeout(() => { document.getElementById('target').textContent = 'Pay now'; }, 800)">Arm</button>`,
  "/secret": `<!doctype html><title>Sign in</title>
    <label>Email <input id="email" value="someone@example.com"></label>
    <label>One-time code <input id="code"></label>
    <button onclick="document.getElementById('status').textContent = 'Code length: ' + document.getElementById('code').value.length">Check</button>
    <p id="status"></p>`,
  "/otp": `<!doctype html><title>Verify</title>
    <form action="/otp-done" method="get"><label>Code <input name="code" id="code"></label><button>Verify</button></form>`,
  "/otp-done": `<!doctype html><title>Verified</title><p>Verified</p>`,
  "/files": `<!doctype html><title>Files</title>
    <a href="/report.csv" download>Download the report</a>
    <button onclick="document.getElementById('answer').textContent = confirm('Delete everything?') ? 'deleted' : 'kept'">Delete everything</button>
    <p id="answer"></p>`,
  "/typing": `<!doctype html><title>Typing</title><style>body{margin:0}input{position:absolute;left:0;top:0;width:400px;height:40px}</style>
    <input id="box" aria-label="Box">`,
  "/animate": `<!doctype html><title>Animate</title><body><div id="d" style="width:200px;height:200px;background:#f00"></div>
    <script>let i=0;setInterval(()=>{document.getElementById('d').style.background=(i++%2)?'#f00':'#00f'},50)</script></body>`,
  "/meta-img": `<!doctype html><title>Meta image</title><p>Hello</p><img src="http://169.254.169.254/latest/meta-data/" alt="probe">`,
  "/long": `<!doctype html><title>Long</title>${Array.from(
    { length: 600 },
    (_, i) => `<p>Paragraph ${i} with some words to make the line longer.</p><button>Button ${i}</button>`,
  ).join("")}`,
};

export interface TestSite {
  base: string;
  port: number;
  close(): Promise<void>;
}

export async function startSite(): Promise<TestSite> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/slow") {
      setTimeout(() => {
        res.setHeader("content-type", "text/html");
        res.end("<!doctype html><title>Slow</title><p>Finally</p>");
      }, 1500);
      return;
    }
    if (path === "/report.csv") {
      res.writeHead(200, {
        "content-type": "text/csv",
        "content-disposition": 'attachment; filename="report.csv"',
      });
      res.end("month,total\naug,42\n");
      return;
    }
    if (path === "/redirect-meta") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      return;
    }
    const page = PAGES[path];
    if (!page) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The ref the snapshot gives the first line containing `text`. */
export function refOf(snapshot: string, text: string): string {
  const line = snapshot.split("\n").find((l) => l.includes(text) && /\[ref=e\d+\]/.test(l));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`No ref for ${text} in:\n${snapshot}`);
  return ref;
}
