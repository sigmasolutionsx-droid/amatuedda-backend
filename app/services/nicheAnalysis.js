const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Analyze niche based on user tier with formatted HTML output
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

    const analysisMarkdown = completion.choices[0].message.content;
    const scores = extractScores(analysisMarkdown);
    
    // Convert markdown to formatted HTML based on tier
    const analysisHTML = formatAnalysisAsHTML(analysisMarkdown, tier, nicheQuery);
    
    return {
      success: true,
      analysis: analysisHTML,
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
 * Convert markdown analysis to styled HTML
 */
function formatAnalysisAsHTML(markdown, tier, niche) {
  const html = [];
  
  // Header
  html.push(`
    <div class="analysis-header">
      <h2 class="niche-name">${escapeHtml(niche)}</h2>
      <div class="tier-indicator tier-${tier}">${tier.toUpperCase()} ANALYSIS</div>
    </div>
  `);
  
  // Split into sections
  const sections = markdown.split(/(?=##\s)/);
  
  sections.forEach(section => {
    if (!section.trim()) return;
    
    const lines = section.split('\n');
    const titleMatch = lines[0].match(/^##\s+(?:\d+\.\s+)?(.+?)(?:\s+\(Score:\s*\*?\*?(\d+(?:\.\d+)?)\s*\/\s*10\*?\*?\))?$/);
    
    if (titleMatch) {
      const title = titleMatch[1].trim();
      const score = titleMatch[2];
      const content = lines.slice(1).join('\n');
      
      // Special formatting for different sections
      if (title.includes('COMPETITOR GAPS') || title.includes('COMPETITOR GAP')) {
        html.push(formatCompetitorGaps(content, tier));
      } else if (title.includes('MONETIZATION')) {
        html.push(formatMonetizationBlueprints(content, tier));
      } else if (score) {
        html.push(formatScoredSection(title, score, content, tier));
      } else {
        html.push(formatGenericSection(title, content, tier));
      }
    }
  });
  
  return html.join('\n');
}

/**
 * Format scored sections (Market Demand, Competition, etc.)
 */
function formatScoredSection(title, score, content, tier) {
  const scoreColor = score >= 7 ? '#4ade80' : score >= 5 ? '#fbbf24' : '#f87171';
  
  return `
    <div class="section scored-section">
      <div class="section-header">
        <h3>${escapeHtml(title)}</h3>
        <div class="score-badge" style="background: ${scoreColor}20; border-color: ${scoreColor}; color: ${scoreColor}">
          ${score}/10
        </div>
      </div>
      <div class="section-content">
        ${formatMarkdown(content)}
      </div>
    </div>
  `;
}

/**
 * Format competitor gaps section (ELITE & ORACLE only)
 */
function formatCompetitorGaps(content, tier) {
  if (tier === 'free') return '';
  
  const html = [`
    <div class="section gaps-section">
      <div class="section-header">
        <h3>🎯 Competitor Gaps & Opportunities</h3>
        <div class="elite-badge">ELITE+</div>
      </div>
      <div class="section-content">
  `];
  
  // Parse gap entries
  const gapMatches = content.matchAll(/\|\s*(\d+)\s*\|\s*\*\*([^*]+)\*\*\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/g);
  
  for (const match of gapMatches) {
    const [_, num, category, need, missing, pain, opportunity, difficulty] = match;
    const difficultyLower = difficulty.trim().toLowerCase();
    const difficultyColor = difficultyLower.includes('low') ? '#4ade80' : 
                           difficultyLower.includes('high') ? '#f87171' : '#fbbf24';
    
    html.push(`
      <div class="gap-card">
        <div class="gap-header">
          <span class="gap-number">${num}</span>
          <h4>${escapeHtml(category.trim())}</h4>
          <span class="difficulty-badge" style="background: ${difficultyColor}20; color: ${difficultyColor}">
            ${escapeHtml(difficulty.trim())}
          </span>
        </div>
        <div class="gap-details">
          <div class="gap-item">
            <strong>What's Missing:</strong> ${escapeHtml(missing.trim())}
          </div>
          <div class="gap-item">
            <strong>Customer Pain:</strong> ${escapeHtml(pain.trim())}
          </div>
          <div class="gap-item">
            <strong>Opportunity:</strong> ${escapeHtml(opportunity.trim())}
          </div>
        </div>
      </div>
    `);
  }
  
  html.push(`
      </div>
    </div>
  `);
  
  return html.join('\n');
}

/**
 * Format monetization blueprints (ORACLE only)
 */
function formatMonetizationBlueprints(content, tier) {
  if (tier !== 'oracle') return '';
  
  const html = [`
    <div class="section monetization-section">
      <div class="section-header">
        <h3>💰 Monetization Blueprints</h3>
        <div class="oracle-badge">ORACLE EXCLUSIVE</div>
      </div>
      <div class="section-content">
  `];
  
  // Parse blueprint sections
  const blueprintMatches = content.matchAll(/\*\*Gap #(\d+)[:\s–-]+([^*]+)\*\*/g);
  
  for (const match of blueprintMatches) {
    const gapNum = match[1];
    const gapName = match[2].trim();
    
    html.push(`
      <div class="blueprint-card">
        <div class="blueprint-header">
          <h4>Gap #${gapNum}: ${escapeHtml(gapName)}</h4>
        </div>
        <div class="blueprint-content">
    `);
    
    // Extract metrics table if present
    const tableMatch = content.match(new RegExp(`Gap #${gapNum}[^|]+((?:\\|[^\\n]+\\n)+)`, 's'));
    if (tableMatch) {
      html.push(formatMarkdown(tableMatch[1]));
    }
    
    html.push(`
        </div>
      </div>
    `);
  }
  
  html.push(`
      </div>
    </div>
  `);
  
  return html.join('\n');
}

/**
 * Format generic section
 */
function formatGenericSection(title, content, tier) {
  return `
    <div class="section">
      <div class="section-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="section-content">
        ${formatMarkdown(content)}
      </div>
    </div>
  `;
}

/**
 * Basic markdown to HTML conversion
 */
function formatMarkdown(text) {
  if (!text) return '';
  
  let html = text
    // Tables
    .replace(/\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/g, (match, header, rows) => {
      const headers = header.split('|').filter(h => h.trim()).map(h => `<th>${escapeHtml(h.trim())}</th>`).join('');
      const rowsHtml = rows.trim().split('\n').map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${escapeHtml(c.trim())}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    })
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Lists
    .replace(/^[\s]*[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  return `<p>${html}</p>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Get AI configuration based on user tier (same as before)
 */
function getAnalysisConfig(nicheQuery, tier) {
  // Same configuration as before - keeping AI prompts identical
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

Create a table with these columns and identify 5-7 specific gaps:

| # | Gap Category | Specific Unmet Need | What's Missing | Customer Pain Point | Opportunity | Difficulty |

Examples of gap categories:
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

Create a table with these columns and identify 5-7 specific gaps:

| # | Gap Category | Specific Unmet Need | What's Missing | Customer Pain Point | Opportunity | Difficulty |

## MONETIZATION BLUEPRINTS
For the top 3 most promising gaps, provide detailed monetization analysis in a table format:

**Gap #1: [Name]**

| Element | Detail |
|---------|--------|
| Revenue Model | [Subscription/One-time/Freemium/Marketplace/etc.] |
| Pricing Strategy | [Specific price points with justification] |
| Revenue Streams | [Primary and secondary income sources] |
| CAC Estimate | $X |
| LTV Estimate | $X |
| Unit Economics | [Margins, break-even point] |
| Go-to-Market | [Specific launch tactics] |
| Competitive Moat | [How to defend this position] |
| 12-Month Revenue Projection | $X with Y customers |

[Repeat for Gap #2 and Gap #3]

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
    const marketMatch = text.match(/MARKET DEMAND.*?Score:\s*\*?\*?(\d+)\s*\/\s*10\*?\*?/is);
    if (marketMatch) scores.market = parseInt(marketMatch[1]);
    
    const competitionMatch = text.match(/COMPETITION.*?Score:\s*\*?\*?(\d+)\s*\/\s*10\*?\*?/is);
    if (competitionMatch) scores.competition = parseInt(competitionMatch[1]);
    
    const profitabilityMatch = text.match(/PROFITABILITY.*?Score:\s*\*?\*?(\d+)\s*\/\s*10\*?\*?/is);
    if (profitabilityMatch) scores.profitability = parseInt(profitabilityMatch[1]);
    
    const overallMatch = text.match(/OPPORTUNITY ASSESSMENT.*?Overall Score:\s*\*?\*?(\d+(?:\.\d+)?)\s*\/\s*10\*?\*?/is);
    if (overallMatch) scores.overall = parseFloat(overallMatch[1]);
  } catch (e) {
    console.error('Score extraction error:', e);
  }
  return scores;
}

module.exports = { analyzeNiche };
