const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function analyzeNiche(nicheQuery) {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: "You are a senior market research analyst specializing in niche validation. Provide comprehensive analysis with numerical scores (1-10), specific examples, and actionable recommendations."
        },
        {
          role: "user",
          content: `Analyze this niche: "${nicheQuery}"

Provide:
## MARKET DEMAND (Score: X/10)
- Search volume estimate
- Growth trend
- Market size

## COMPETITION (Score: X/10)  
- Competition level (Low/Med/High)
- Key competitors
- Barriers to entry

## PROFITABILITY (Score: X/10)
- Revenue potential
- Monetization methods
- Startup costs

## TARGET AUDIENCE
- Demographics
- Pain points
- Where they are online

## OPPORTUNITY ASSESSMENT (Overall Score: X/10)
- Best for which entrepreneur
- Success factors
- Challenges
- Quick-win strategies

## RELATED NICHES
1-5 related opportunities

Be honest about challenges.`
        }
      ],
      temperature: 0.35,
      max_tokens: 3000
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
