# Scout-Faire Pro/Enterprise Report Upgrade

This rebuild upgrades the report layer from a simple niche scorecard into a Pro/Enterprise strategy report.

## What changed

- Added a correct `package.json` and `server.js` so `npm start` works on Railway/Node hosts.
- Kept `scout_faire_server.js` as a compatibility copy.
- Expanded the Groq-powered prompt from a basic analysis into a structured business intelligence report.
- Added robust JSON extraction and normalization so minor AI formatting issues do not crash the app.
- Raised `max_tokens` to support deeper reports.
- Added report sections for:
  - Executive summary
  - Portfolio verdict
  - Best bet
  - Strategic warnings
  - Opportunity score
  - Market thesis
  - Buyer pain
  - Target buyer
  - Money path
  - Pricing strategy
  - Offer stack
  - Competitor gaps
  - Go-to-market actions
  - Campaign/content angles
  - Validation plan
  - Risk flags
  - First 30 days
  - 90-day roadmap
  - KPIs
- Upgraded the export from a short text summary into an enterprise-style report document.
- Added a Print/PDF button so the report can be saved as a polished PDF from the browser.

## Environment variables

Required:

```bash
GROQ_API_KEY=your_key_here
```

The server now calls Groq through the OpenAI-compatible chat completions endpoint and defaults to `openai/gpt-oss-120b`.

Optional:

```bash
GROQ_MODEL=openai/gpt-oss-120b
PORT=3000
```


## Latest Upgrade: Competitor Gap Monetization

The report engine now treats competitor gaps as the core value of the deliverable. For each niche, the AI is required to return a `gapMonetizationPlan` with:

- the exact gap or underserved customer frustration
- why buyers care enough to pay or switch
- the money move that turns the gap into revenue
- a named offer
- pricing logic
- step-by-step execution plan
- proof to collect
- the first campaign to launch

This section is rendered in the web report and included in the exported enterprise text report.
