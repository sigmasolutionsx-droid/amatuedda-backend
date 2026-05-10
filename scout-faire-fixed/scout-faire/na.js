const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Analyze niche based on user tier
 * @param {string} nicheQuery - The niche to analyze
 * @param {string} tier - 'free', 'elite', or 'oracle'
 */
async function analyzeNiche(nicheQuery, tier = 'free') {
  try {
    const config = getTierConfig(nicheQuery, tier);
    console.log(`Analyzing "${nicheQuery}" with tier: ${tier}, model: ${config.model}`);

    const completion = await groq.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: config.userPrompt }
      ],
      temperature: tier === 'oracle' ? 0.35 : 0.5,
      max_tokens: tier === 'free' ? 2500 : (tier === 'elite' ? 3800 : 5500)
    });

    const analysisText = completion.choices[0].message.content;
    const scores = extractScores(analysisText);

    return {
      success: true,
      analysis: analysisText,
      scores,
      model: config.model,
      tier,
      usage: completion.usage,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Groq Analysis Error:", error);
    return {
      success: false,
      error: error.message || "Analysis failed",
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get the correct prompt & model for each tier
 * FREE: hooks curiosity, gives value, no execution blueprint
 * ELITE: reveals competitor gaps and strategic direction, no monetization engineering
 * ORACLE: full execution architecture, monetization blueprints, financials
 */
function getTierConfig(nicheQuery, tier) {
  const baseUserPrompt = `Analyze this niche: "${nicheQuery}"`;

  // ---------- FREE TIER ----------
  if (tier === 'free') {
    return {
      model: "llama-3.1-8b-instant",
      systemPrompt: `You are a market research analyst. Provide concise, valuable niche analysis.
Your goal: hook curiosity, give real insight, create confidence, reveal opportunity – but never give the execution blueprint.
DO NOT include: gap exploitation, monetization systems, CAC/LTV, revenue projections, business model canvases, strategic roadmaps.`,
      userPrompt: `${baseUserPrompt}

Provide a structured report:

## MARKET DEMAND (Score: X/10)
- Estimated monthly search volume (low/med/high)
- Growth trajectory (growing/stable/declining)
- Market size (small/medium/large)

## COMPETITION (Score: X/10)
- Competition level (Low/Medium/High)
- Key competitors (name 3-5 specific companies)
- Market concentration (fragmented or dominated?)
- Barriers to entry

## PROFITABILITY (Score: X/10)
- Revenue potential for solo entrepreneur (low/medium/high)
- Best monetization methods (top 3 – names only, no pricing systems)
- Typical pricing ranges (ballpark)
- Startup capital estimate (low/medium/high)

## TARGET AUDIENCE
- Primary demographics
- Core pain points
- Where they congregate online
- Purchase triggers

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best for which type of entrepreneur
- Required skills/background
- Critical success factors (top 3)
- Major challenges/risks (top 3)
- Time to first revenue estimate

## FINAL VERDICT
2-3 sentences: Is this a good opportunity? For whom? Biggest factor to consider?

Be honest, concrete, but do NOT give execution blueprints or detailed monetization models.`
    };
  }

  // ---------- ELITE TIER ----------
  if (tier === 'elite') {
    return {
      model: "openai/gpt-oss-20b",
      systemPrompt: `You are a senior market intelligence analyst specializing in niche validation and competitor research.
Your role: identify market opportunities, competitor weaknesses, underserved segments, and strategic positioning angles.
DO NOT provide: monetization blueprints, revenue projections, CAC/LTV, financial modeling, full business architecture.`,
      userPrompt: `${baseUserPrompt}

Provide:

## MARKET DEMAND (Score: X/10)
- Estimated monthly search volume (range)
- Growth trajectory (% if estimable)
- Market size ($ if possible)

## COMPETITION (Score: X/10)
- Competition level (Low/Med/High)
- Top competitors (names + what they do well/poorly)
- Market fragmentation
- Entry barriers

## COMPETITOR GAPS & OPPORTUNITIES
Identify 5-7 specific gaps competitors are failing to solve.

For each gap:
- What's missing (be specific)
- Customer frustration this creates
- Why competitors ignore it
- Strategic opportunity
- Difficulty (Low/Medium/High)

## TARGET AUDIENCE (Deep)
- Demographics (age, income, education, location)
- Psychographics (values, fears, aspirations)
- Core pain points (ranked by urgency)
- Purchase triggers
- Online behavior & content preferences

## POSITIONING OPPORTUNITIES
- Differentiation angles (3-5 messaging hooks)
- Underserved customer segments
- Brand positioning ideas

## ENTRY STRATEGIES
Provide 3 realistic ways a new entrepreneur could enter this market (channels, partnerships, initial offer types – no pricing/unit economics).

## CONTENT & TRAFFIC STRATEGY
- Best platforms (with reasoning)
- Best content formats
- Organic traffic opportunities
- Community-building opportunities

## RELATED SUB‑NICHES
List 5 adjacent sub‑niches worth exploring.

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best entrepreneur fit (solo vs team, budget, skills)
- Required skills/background
- Major risks (top 3)
- Time‑to‑results estimate (weeks/months)

## FINAL VERDICT
2-3 sentence strategic summary.

**IMPORTANT:** Focus on market intelligence and strategic direction. No monetization systems, pricing, CAC/LTV, financial projections, or business model canvases.`
    };
  }

  // ---------- ORACLE TIER ----------
  return {
    model: "openai/gpt-oss-120b",
    systemPrompt: `You are an elite market research strategist and business architect.
Provide complete execution architecture: gap analysis, monetization blueprints, pricing models, CAC/LTV, unit economics, go‑to‑market, and business model canvases.`,
    userPrompt: `${baseUserPrompt} – Oracle tier.

Return a complete execution roadmap with:

## MARKET DEMAND (Score: X/10)
- Estimated monthly search volume
- Growth trajectory (%)
- Market size estimate ($)
- Trend direction

## COMPETITION (Score: X/10)
- Top competitors (names + detailed analysis)
- Market share estimation
- Barriers to entry

## COMPETITOR GAPS (5-7 specific gaps)
For each gap: description, customer pain, why competitors miss it, opportunity.

## MONETIZATION BLUEPRINTS (for the top 3 gaps)
Each blueprint must include:
- Revenue model (subscription/one‑time/freemium/marketplace)
- Pricing strategy (specific price points + justification)
- Revenue streams (primary & secondary)
- Customer Acquisition Cost (CAC) estimate ($)
- Lifetime Value (LTV) estimate ($)
- Unit economics (margins, break‑even)
- Go‑to‑market strategy (specific launch tactics)
- Competitive moat
- 12‑month revenue projection ($ with customer count)

## PROFITABILITY (Score: X/10)
- Revenue potential (solo entrepreneur)
- Revenue potential (small team)
- Gross margin expectations
- Startup capital estimate
- Profitability timeline (months to break‑even)

## TARGET AUDIENCE (full profile)
- Demographics, psychographics, willingness to pay

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best entrepreneur fit
- Required skills
- Critical success factors
- Major risks
- Time to first revenue
- Scale potential (1-10)

## STRATEGIC RECOMMENDATIONS
- Positioning & differentiation angle
- Content strategy outline
- Partnership opportunities
- Related sub‑niches (5 options)
- Platform/channel priorities
- Key metrics to track

## BUSINESS MODEL CANVAS (one‑page summary)
- Value Proposition, Customer Segments, Channels, Customer Relationships, Revenue Streams, Key Resources, Key Activities, Key Partnerships, Cost Structure

## FINAL VERDICT
2-3 sentence summary.

**IMPORTANT:** Be brutally honest. Include realistic numbers. Provide a complete execution architecture.`
  };
}

/**
 * Extract numerical scores from the analysis text
 */
function extractScores(text) {
  const scores = { market: null, competition: null, profitability: null, overall: null };
  try {
    const marketMatch = text.match(/MARKET DEMAND.*?Score:\s*(\d+)\/10/is);
    if (marketMatch) scores.market = parseInt(marketMatch[1]);

    const competitionMatch = text.match(/COMPETITION.*?Score:\s*(\d+)\/10/is);
    if (competitionMatch) scores.competition = parseInt(competitionMatch[1]);

    const profitabilityMatch = text.match(/PROFITABILITY.*?Score:\s*(\d+)\/10/is);
    if (profitabilityMatch) scores.profitability = parseInt(profitabilityMatch[1]);

    const overallMatch = text.match(/OPPORTUNITY ASSESSMENT.*?Overall Score:\s*(\d+(?:\.\d+)?)\/10/is);
    if (overallMatch) scores.overall = parseFloat(overallMatch[1]);
  } catch (err) {
    // Silent fail – scores remain null
  }
  return scores;
}

module.exports = { analyzeNiche };
