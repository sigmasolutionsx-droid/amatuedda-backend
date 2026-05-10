const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function extractJson(text) {
  if (!text) throw new Error('Empty AI response');
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('AI response did not contain valid JSON');
  }
  return JSON.parse(cleaned.slice(first, last + 1));
}

function cleanKeywords(rawKeywords) {
  return rawKeywords
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeReport(report, keywordList) {
  const niches = Array.isArray(report.niches) ? report.niches : [];
  return {
    reportTitle: report.reportTitle || 'Scout-Faire Strategic Market Intelligence Report',
    tierPositioning: report.tierPositioning || 'Pro / Enterprise',
    generatedFor: keywordList.join(', '),
    executiveSummary: report.executiveSummary || report.overallInsight || 'Market intelligence summary unavailable.',
    portfolioVerdict: report.portfolioVerdict || 'Prioritize the highest-intent niche first, validate willingness to pay, then expand into adjacent offers after demand is proven.',
    bestBet: report.bestBet || (niches[0]?.keyword || keywordList[0] || 'Primary niche'),
    confidenceLevel: report.confidenceLevel || 'Medium',
    strategicWarnings: Array.isArray(report.strategicWarnings) ? report.strategicWarnings : [],
    niches: niches.map((niche, index) => ({
      keyword: niche.keyword || keywordList[index] || `Niche ${index + 1}`,
      opportunityScore: Number(niche.opportunityScore ?? niche.profitability ?? 0),
      confidence: niche.confidence || 'Medium',
      trend: niche.trend || 'stable',
      searchVolume: niche.searchVolume || 'medium',
      competition: niche.competition || 'medium',
      buyIntent: niche.buyIntent || 'medium',
      marketThesis: niche.marketThesis || niche.opportunity || 'This niche needs sharper positioning before investment.',
      buyerPain: niche.buyerPain || 'The buyer has a painful problem, but the exact urgency needs validation.',
      moneyPath: niche.moneyPath || 'Start with a paid diagnostic, then sell implementation or a recurring support package.',
      targetBuyer: niche.targetBuyer || 'Specific buyer persona needs validation.',
      offerStack: Array.isArray(niche.offerStack) ? niche.offerStack : ['Low-risk diagnostic', 'Implementation package', 'Recurring optimization plan'],
      pricingStrategy: niche.pricingStrategy || 'Use a paid entry offer, then move qualified buyers into a higher-ticket implementation path.',
      competitorGaps: Array.isArray(niche.competitorGaps) ? niche.competitorGaps : [],
      gapMonetizationPlan: Array.isArray(niche.gapMonetizationPlan) ? niche.gapMonetizationPlan : [],
      goToMarket: Array.isArray(niche.goToMarket) ? niche.goToMarket : (Array.isArray(niche.recommendations) ? niche.recommendations : []),
      contentAngles: Array.isArray(niche.contentAngles) ? niche.contentAngles : [],
      validationPlan: Array.isArray(niche.validationPlan) ? niche.validationPlan : [],
      riskFlags: Array.isArray(niche.riskFlags) ? niche.riskFlags : [],
      firstThirtyDays: Array.isArray(niche.firstThirtyDays) ? niche.firstThirtyDays : []
    })),
    emergingOpportunities: Array.isArray(report.emergingOpportunities) ? report.emergingOpportunities : [],
    ninetyDayRoadmap: Array.isArray(report.ninetyDayRoadmap) ? report.ninetyDayRoadmap : [],
    kpis: Array.isArray(report.kpis) ? report.kpis : []
  };
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { keywords } = req.body;

    if (!keywords || !keywords.trim()) {
      return res.status(400).json({ error: 'Keywords are required' });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    }

    const keywordList = cleanKeywords(keywords);
    if (!keywordList.length) {
      return res.status(400).json({ error: 'Enter at least one usable keyword.' });
    }

    const prompt = `You are the lead market strategist for Scout-Faire, a premium niche intelligence and business-plan platform for entrepreneurs who may use this report to decide whether to build, sell, advertise, or pursue funding.

Analyze these niches: ${keywordList.join(', ')}

Standard: This must read like a paid Pro/Enterprise strategy report, not a generic AI answer. Be specific, direct, commercially useful, and honest about risks. Do not invent exact statistics, search volumes, or revenue claims. Use realistic market reasoning and label confidence when evidence would need validation.

Mandatory report logic: Every niche must include direct competitor gaps AND a plan to make money from each gap. Do not give vague gaps like "better marketing" or "more features." A good gap names the weakness, identifies the buyer frustration, explains the revenue angle, and gives a practical execution plan. The gapMonetizationPlan is the most important part of the report and should feel like paid consulting.

Return ONLY valid JSON. No markdown. No backticks. Match this exact structure:
{
  "reportTitle": "Scout-Faire Strategic Market Intelligence Report",
  "tierPositioning": "Pro / Enterprise",
  "executiveSummary": "4-6 sentences that summarize the portfolio, the biggest competitor gaps, where the money is, who should buy, and the immediate strategic call.",
  "portfolioVerdict": "Clear verdict on whether to pursue, pause, narrow, or reposition the niche set.",
  "bestBet": "The single strongest niche from the input and why, in one sentence.",
  "confidenceLevel": "High | Medium | Low",
  "strategicWarnings": ["warning 1", "warning 2", "warning 3"],
  "niches": [
    {
      "keyword": "exact keyword from input",
      "opportunityScore": 1-100,
      "confidence": "High | Medium | Low",
      "trend": "rising | stable | declining",
      "searchVolume": "high | medium | low | unknown",
      "competition": "low | medium | high",
      "buyIntent": "high | medium | low",
      "marketThesis": "A serious 4-6 sentence thesis explaining the market, demand driver, urgency, monetization potential, and strategic angle.",
      "buyerPain": "The expensive, urgent, emotional, or operational pain the buyer is trying to solve.",
      "targetBuyer": "A clear target customer profile with role, situation, and trigger event.",
      "moneyPath": "How this can realistically become revenue by exploiting competitor gaps, including first product, core offer, upsell, and retention angle.",
      "pricingStrategy": "Specific pricing logic with low-ticket, core, and premium/enterprise positioning where appropriate.",
      "offerStack": ["entry offer", "core offer", "premium offer", "recurring/retainer offer"],
      "competitorGaps": ["Specific competitor weakness or underserved buyer need 1", "Specific competitor weakness or underserved buyer need 2", "Specific competitor weakness or underserved buyer need 3", "Specific competitor weakness or underserved buyer need 4"],
      "gapMonetizationPlan": [
        {
          "gap": "The exact competitor gap or underserved customer frustration. Return 3-4 objects like this for each niche.",
          "whyItMatters": "Why buyers care enough to switch, pay, or book a call.",
          "moneyMove": "The product, service, package, or campaign that turns this gap into revenue.",
          "offer": "A named offer with what is included and who it is for.",
          "priceLogic": "Suggested price band or pricing approach and why it fits the buyer intent.",
          "executionPlan": ["Step 1 to capture the gap", "Step 2 to package it", "Step 3 to sell it", "Step 4 to retain/expand revenue"],
          "proofToCollect": "The testimonial, audit finding, before/after, case study, or data point needed to prove the gap.",
          "firstCampaign": "The first ad, email, video, landing page, or outreach campaign to run against this gap."
        }
      ],
      "goToMarket": ["actionable channel/tactic 1", "actionable channel/tactic 2", "actionable channel/tactic 3", "actionable channel/tactic 4"],
      "contentAngles": ["video/blog/ad angle 1", "angle 2", "angle 3", "angle 4"],
      "validationPlan": ["validation step 1", "validation step 2", "validation step 3", "validation step 4"],
      "riskFlags": ["risk 1", "risk 2", "risk 3"],
      "firstThirtyDays": ["week/action 1", "week/action 2", "week/action 3", "week/action 4"]
    }
  ],
  "emergingOpportunities": ["adjacent opportunity 1", "adjacent opportunity 2", "adjacent opportunity 3", "adjacent opportunity 4"],
  "ninetyDayRoadmap": ["days 1-15", "days 16-30", "days 31-60", "days 61-90"],
  "kpis": ["KPI 1", "KPI 2", "KPI 3", "KPI 4", "KPI 5"]
}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_completion_tokens: 12000,
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are Scout-Faire, a premium market strategy report engine. Return only strict JSON that matches the requested schema.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Groq API error: ${response.status} ${text}`);
    }

    const data = await response.json();
    const analysisText = data.choices?.[0]?.message?.content || '';
    const report = normalizeReport(extractJson(analysisText), keywordList);

    res.json({ analysis: report });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      error: 'Failed to generate the Scout-Faire report. Please try again.',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Scout-Faire API' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Scout-Faire server running on port ${PORT}`);
});
