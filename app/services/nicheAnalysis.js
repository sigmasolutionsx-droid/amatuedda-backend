const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Analyze niche based on user tier
 * @param {string} nicheQuery - The niche to analyze
 * @param {string} tier - User tier: 'free', 'elite', or 'oracle'
 */
async function analyzeNiche(nicheQuery, tier = 'free') {
  try {
    // Select model and prompt based on tier
    const { model, systemPrompt, userPrompt } = getAnalysisConfig(nicheQuery, tier);
    
    console.log(`Analyzing "${nicheQuery}" with tier: ${tier}, model: ${model}`);
    
    const completion = await groq.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: tier === 'oracle' ? 0.35 : 0.5,
      max_tokens: tier === 'free' ? 2000 : (tier === 'elite' ? 3500 : 4500)
    });

    const analysisText = completion.choices[0].message.content;
    const scores = extractScores(analysisText);
    
    return {
      success: true,
      analysis: analysisText,
      scores: scores,
      model: model,
      tier: tier,
      usage: completion.usage,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Analysis Error:", error);
    return {
      success: false,
      error: error.message || "Analysis failed",
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get AI configuration based on user tier
 */
function getAnalysisConfig(nicheQuery, tier) {
  const configs = {
    free: {
      model: "llama-3.1-8b-instant",
      systemPrompt: "You are a market research analyst providing concise niche analysis. Focus on core market fundamentals: demand, competition, and basic opportunity assessment. Provide numerical scores (1-10) and actionable insights.",
      userPrompt: `Analyze this niche: "${nicheQuery}"

Provide a focused analysis covering:

## MARKET DEMAND (Score: X/10)
- Estimated monthly search volume
- Growth trajectory
- Market size estimate
- Trend status: Growing/Stable/Declining

## COMPETITION (Score: X/10)
- Competition level (Low/Medium/High)
- Key competitors (name 3-5 specific companies/brands)
- Market concentration (dominated or fragmented?)
- Barriers to entry

## PROFITABILITY (Score: X/10)
- Revenue potential for solo entrepreneur
- Best monetization methods (top 3)
- Typical pricing ranges
- Estimated startup capital needed

## TARGET AUDIENCE
- Primary demographics (age, gender, income, location)
- Core pain points being solved
- Where they congregate online
- Purchase triggers

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best for which type of entrepreneur
- Required skills/background
- Critical success factors (top 3)
- Major challenges/risks (top 3)
- Time to first revenue estimate

## FINAL VERDICT
2-3 sentence summary: Is this a good opportunity? For whom? What's the biggest factor to consider?

**IMPORTANT:** Be brutally honest about challenges. Provide concrete examples and realistic numbers.`
    },
    
    elite: {
      model: "openai/gpt-oss-20b",
      systemPrompt: "You are a senior market research analyst specializing in niche validation and competitive intelligence. Your expertise includes identifying market gaps and unmet customer needs that competitors are missing. Provide comprehensive analysis with numerical scores (1-10), specific examples, and actionable competitor gap analysis.",
      userPrompt: `Analyze this niche: "${nicheQuery}"

Provide:

## MARKET DEMAND (Score: X/10)
- Estimated monthly search volume
- Growth trajectory (% if estimable)
- Market size estimate
- Trend status: Growing/Stable/Declining

## COMPETITION (Score: X/10)
- Competition level (Low/Med/High)
- Key competitors (name 3-5 specific companies/brands)
- Market concentration (dominated or fragmented?)
- Barriers to entry

## COMPETITOR GAPS & OPPORTUNITIES
**Critical Analysis:** What are competitors NOT doing that customers want?

Identify 5-7 specific gaps:
1. **[Gap Category]** - [Specific unmet need]
   - What's missing: [Be specific]
   - Customer pain point: [What frustration does this create?]
   - Opportunity: [How to exploit this gap]
   - Difficulty to execute: [Low/Medium/High]

Examples of gap categories to look for:
- Product/Service gaps (features, quality, variety)
- Pricing gaps (premium tier, budget option, flexible payment)
- Customer segment gaps (underserved demographics)
- Geographic gaps (regions not covered)
- Channel gaps (platforms not being used)
- Content/Education gaps (missing resources)
- Experience gaps (customer service, delivery, personalization)

## PROFITABILITY (Score: X/10)
- Revenue potential (solo entrepreneur)
- Revenue potential (small team 2-5 people)
- Best monetization methods (ranked)
- Typical pricing ranges
- Gross margin expectations
- Startup capital estimate

## TARGET AUDIENCE
- Primary demographics (age, gender, income, location)
- Core pain points being solved
- Where they congregate online
- Content preferences
- Purchase triggers

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best for which type of entrepreneur
- Required skills/background
- Critical success factors (top 3)
- Major challenges/risks (top 3)
- Time to first revenue estimate
- Quick-win entry strategies (3 specific tactics)

## STRATEGIC RECOMMENDATIONS
- Positioning & differentiation angle
- Content strategy outline
- Partnership opportunities
- Related sub-niches to explore (5 options)

## FINAL VERDICT
2-3 sentence summary: Is this a good opportunity? For whom? What's the biggest factor to consider?

**IMPORTANT:**
- Be brutally honest about challenges
- Competitor gaps should be SPECIFIC and ACTIONABLE
- Include real company names where possible
- Provide concrete examples and numbers`
    },
    
    oracle: {
      model: "openai/gpt-oss-120b",
      systemPrompt: "You are an elite market research strategist with deep expertise in niche validation, competitive intelligence, and business model design. You identify not just what competitors are missing, but exactly how to monetize those gaps profitably. Provide comprehensive analysis with numerical scores (1-10), specific examples, detailed competitor gap analysis, and complete monetization blueprints.",
      userPrompt: `Analyze this niche: "${nicheQuery}"

Provide:

## MARKET DEMAND (Score: X/10)
- Estimated monthly search volume
- Growth trajectory (% if estimable)
- Market size estimate
- Trend status: Growing/Stable/Declining

## COMPETITION (Score: X/10)
- Competition level (Low/Med/High)
- Key competitors (name 3-5 specific companies/brands)
- Market concentration (dominated or fragmented?)
- Barriers to entry

## COMPETITOR GAPS & OPPORTUNITIES
**Critical Analysis:** What are competitors NOT doing that customers want?

Identify 5-7 specific gaps:
1. **[Gap Category]** - [Specific unmet need]
   - What's missing: [Be specific]
   - Customer pain point: [What frustration does this create?]
   - Opportunity: [How to exploit this gap]
   - Difficulty to execute: [Low/Medium/High]

Examples of gap categories to look for:
- Product/Service gaps (features, quality, variety)
- Pricing gaps (premium tier, budget option, flexible payment)
- Customer segment gaps (underserved demographics)
- Geographic gaps (regions not covered)
- Channel gaps (platforms not being used)
- Content/Education gaps (missing resources)
- Experience gaps (customer service, delivery, personalization)

## MONETIZATION BLUEPRINTS (For Each Gap)
For the top 3 most promising gaps, provide:

**Gap #1: [Name]**
- **Revenue Model:** [Subscription/One-time/Freemium/Marketplace/etc.]
- **Pricing Strategy:** [Specific price points with justification]
- **Revenue Streams:** [Primary and secondary income sources]
- **Customer Acquisition Cost (CAC) Estimate:** $X
- **Lifetime Value (LTV) Estimate:** $X
- **Unit Economics:** [Margins, break-even point]
- **Go-to-Market Strategy:** [Specific launch tactics]
- **Competitive Moat:** [How to defend this position]
- **12-Month Revenue Projection:** $X with Y customers

**Gap #2: [Name]**
[Same structure as Gap #1]

**Gap #3: [Name]**
[Same structure as Gap #1]

## PROFITABILITY (Score: X/10)
- Revenue potential (solo entrepreneur)
- Revenue potential (small team 2-5 people)
- Best monetization methods (ranked with reasoning)
- Typical pricing ranges
- Gross margin expectations
- Startup capital estimate
- Profitability timeline (months to break-even)

## TARGET AUDIENCE
- Primary demographics (age, gender, income, location)
- Core pain points being solved
- Where they congregate online
- Content preferences
- Purchase triggers
- Willingness to pay analysis

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best for which type of entrepreneur
- Required skills/background
- Critical success factors (top 3)
- Major challenges/risks (top 3)
- Time to first revenue estimate
- Quick-win entry strategies (3 specific tactics)
- Scale potential (1-10)

## STRATEGIC RECOMMENDATIONS
- Positioning & differentiation angle
- Content strategy outline
- Partnership opportunities
- Related sub-niches to explore (5 options)
- Platform/channel priorities
- Key metrics to track

## BUSINESS MODEL CANVAS (One-Page Summary)
- Value Proposition
- Customer Segments
- Channels
- Customer Relationships
- Revenue Streams
- Key Resources
- Key Activities
- Key Partnerships
- Cost Structure

## FINAL VERDICT
2-3 sentence summary: Is this a good opportunity? For whom? What's the biggest factor to consider?

**IMPORTANT:**
- Be brutally honest about challenges
- Competitor gaps should be SPECIFIC and ACTIONABLE
- Monetization blueprints must include realistic numbers
- Include real company names where possible
- Provide concrete examples with financial projections`
    }
  };
  
  return configs[tier] || configs.free;
}

/**
 * Extract numerical scores from analysis text
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
  } catch (e) {
    console.error('Score extraction error:', e);
  }
  return scores;
}

module.exports = { analyzeNiche };
