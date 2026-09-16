import express, { type Request, type Response } from "express";

const FAKE_MEMBERS = new Map([
  ["12345", { name: "Avery Example", tier: "Standard", savingsAccount: "SAV-000123", balance: "$12,340.22" }],
  ["70000", { name: "Taylor Training", tier: "Standard", savingsAccount: "SAV-000700", balance: "$7,000.00" }],
  ["88888", { name: "Morgan Modal", tier: "Standard", savingsAccount: "SAV-000888", balance: "$888.88" }],
]);

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function page(title: string, content: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | LegacyBank Admin Simulator</title>
  <link rel="stylesheet" href="/assets/legacy.css">
</head>
<body>
  <table class="shell" role="presentation">
    <tr><td class="masthead"><span>LegacyBank</span> Admin Simulator <small>TRAINING SYSTEM — FAKE DATA ONLY</small></td></tr>
    <tr><td class="nav"><a href="/">Member Search</a> | <a href="/help">Help</a> | Operator: demo.user</td></tr>
    <tr><td class="content">${content}</td></tr>
    <tr><td class="footer">LegacyBank Systems © 2004–2026 · Simulator build 7.4</td></tr>
  </table>
  ${script}
</body>
</html>`;
}

function searchForm(message = ""): string {
  return `<h1>Member Search</h1>
  ${message}
  <form method="get" action="/members/search">
    <fieldset><legend>Search Criteria</legend>
      <table class="form-table" role="presentation"><tr>
        <td><label for="member_id">Member ID</label></td>
        <td><input id="member_id" name="member_id" inputmode="numeric" autocomplete="off" maxlength="10"></td>
        <td><button type="submit">Search</button></td>
      </tr></table>
    </fieldset>
  </form>
  <p class="hint">Authorized training use only. Try member ID 12345.</p>`;
}

function resultPage(memberId: string): string {
  const member = FAKE_MEMBERS.get(memberId);
  if (!member) throw new Error("Result page requested for unknown demo member");
  return `<h1>Member Details</h1>
  <div class="notice success" role="status">Member record loaded.</div>
  <table class="details">
    <caption>Member Profile</caption>
    <tr><th>Member ID</th><td>${memberId}</td><th>Member Name</th><td>${member.name}</td></tr>
    <tr><th>Service Tier</th><td>${member.tier}</td><th>Status</th><td>Active</td></tr>
  </table>
  <h2>Accounts</h2>
  <iframe title="Member accounts" src="/members/${memberId}/accounts"></iframe>
  <p><a class="button-link" href="/members/${memberId}/sub-account/new">Open New Sub-Account</a></p>`;
}

export function createLegacyBankApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use("/assets", express.static(new URL("./public", import.meta.url).pathname));

  app.get("/", (_request, response) => response.send(page("Member Search", searchForm())));

  app.get("/members/search", async (request: Request, response: Response) => {
    const memberId = String(request.query.member_id ?? "").trim();
    if (memberId === "70000") await new Promise((resolve) => setTimeout(resolve, 1_500));

    switch (memberId) {
      case "12345":
      case "70000":
      case "88888": {
        const modal = memberId === "88888"
          ? `<div id="unexpected-modal" class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">Records Notice</h2><p>This unexpected training notice requires operator review.</p><button type="button" onclick="document.getElementById('unexpected-modal').remove()">Acknowledge and Continue</button></div></div>`
          : "";
        response.send(page("Member Details", resultPage(memberId), modal));
        return;
      }
      case "40400":
        response.status(404).send(page("Member Not Found", searchForm(`<div class="notice warning" role="alert">Member Not Found: No member was found for ID 40400.</div>`)));
        return;
      case "40300":
        response.status(403).send(page("Permission Denied", `<h1>Permission Denied</h1><div class="notice error" role="alert">PERMISSION_DENIED: Your operator profile cannot access this member.</div><p><a href="/">Return to Member Search</a></p>`));
        return;
      case "50000":
        response.status(500).send(page("Application Error", `<h1>Application Error</h1><div class="notice error" role="alert">APP_ERROR: The legacy host returned an application error.</div><p>Reference: DEMO-50000</p>`));
        return;
      default:
        response.status(400).send(page("Invalid Search", searchForm(`<div class="notice warning" role="alert">Enter a recognized demo Member ID.</div>`)));
    }
  });

  app.get("/members/:memberId/accounts", (request, response) => {
    const member = FAKE_MEMBERS.get(request.params.memberId);
    if (!member) {
      response.status(404).send("Account record not found");
      return;
    }
    response.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/legacy.css"></head><body class="frame-body"><table class="accounts"><thead><tr><th>Type</th><th>Account Number</th><th>Current Balance</th><th>Currency</th></tr></thead><tbody><tr><td>Savings</td><td>${member.savingsAccount}</td><td>${member.balance}</td><td>USD</td></tr><tr><td>Checking</td><td>CHK-000124</td><td>$842.17</td><td>USD</td></tr></tbody></table></body></html>`);
  });

  app.get("/members/:memberId/sub-account/new", (request, response) => {
    if (!FAKE_MEMBERS.has(request.params.memberId)) {
      response.status(404).send(page("Member Not Found", `<h1>Member Not Found</h1><p><a href="/">Return to search</a></p>`));
      return;
    }
    const memberId = escapeHtml(request.params.memberId);
    response.send(page("Open New Sub-Account", `<h1>Open New Sub-Account</h1><form method="post" action="/members/${memberId}/sub-account/review"><fieldset><legend>Account Request</legend><p><label for="account_type">Account Type</label> <select id="account_type" name="account_type"><option value="holiday_savings">Holiday Savings</option><option value="emergency_savings">Emergency Savings</option></select></p><p><label for="nickname">Account Nickname</label> <input id="nickname" name="nickname" maxlength="30"></p><button type="submit">Continue to Review</button> <a href="/members/search?member_id=${memberId}">Cancel</a></fieldset></form>`));
  });

  app.post("/members/:memberId/sub-account/review", (request, response) => {
    if (!FAKE_MEMBERS.has(request.params.memberId)) {
      response.status(404).send(page("Member Not Found", `<h1>Member Not Found</h1><p><a href="/">Return to search</a></p>`));
      return;
    }
    if (!["holiday_savings", "emergency_savings"].includes(String(request.body.account_type ?? ""))) {
      response.status(400).send(page("Invalid Account Type", `<h1>Invalid Account Type</h1><p><a href="/">Return to search</a></p>`));
      return;
    }
    const memberId = escapeHtml(request.params.memberId);
    const accountType = escapeHtml(String(request.body.account_type ?? ""));
    const nickname = escapeHtml(String(request.body.nickname ?? ""));
    response.send(page("Review Sub-Account", `<h1>Review — No Changes Submitted</h1><div class="notice warning" role="status">This simulator stops before any account is opened.</div><table class="details"><tr><th>Member ID</th><td>${memberId}</td></tr><tr><th>Account Type</th><td>${accountType}</td></tr><tr><th>Nickname</th><td>${nickname || "(none)"}</td></tr></table><p><a href="/members/${memberId}/sub-account/new">Edit Request</a></p>`));
  });

  app.get("/help", (_request, response) => response.send(page("Help", `<h1>Help</h1><p>This is a fictional legacy application used to demonstrate safe computer-use automation.</p>`)));
  return app;
}
