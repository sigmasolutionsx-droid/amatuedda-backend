const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function analyzeNiche(nicheQuery) {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: "You are a senior market research analyst specializing in niche validation and competitive intelligence. Your expertise includes identifying market gaps and unmet customer needs that competitors are missing. Provide comprehensive analysis with numerical scores (1-10), specific examples, competitor gap analysis, and actionable recommendations."
        },
        {
          role: "user",
          content: `Analyze this niche: "${nicheQuery}"

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
        }
      ],
      temperature: 0.35,
      max_tokens: 4500
    });

    const analysisText = completion.choices[0].message.content;
    const scores = extractScores(analysisText);
    
    return {
      success: true,
      analysis: analysisText,
      scores: scores,
      model: "openai/gpt-oss-120b",
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
