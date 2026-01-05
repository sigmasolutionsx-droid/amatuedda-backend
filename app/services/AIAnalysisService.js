// backend/app/services/AIAnalysisService.js
// AI-powered niche analysis using Groq API (OpenAI/GPT-OSS-120B)

const Groq = require('groq-sdk');

class AIAnalysisService {
  constructor() {
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    this.model = 'gpt-oss-120b'; // Or whatever model name Groq uses
  }

  /**
   * Analyze a niche opportunity with all available data
   */
  async analyzeNiche(niche) {
    try {
      const prompt = this.buildNicheAnalysisPrompt(niche);
      
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `You are an expert market researcher and niche analyst. Analyze niche opportunities based on social media data, pain points, and trends. Provide actionable scores and insights.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const analysis = JSON.parse(completion.choices[0].message.content);
      
      return {
        opportunity_score: this.normalizeScore(analysis.opportunity_score),
        competition_score: this.normalizeScore(analysis.competition_score),
        demand_score: this.normalizeScore(analysis.demand_score),
        growth_score: this.normalizeScore(analysis.growth_score),
        description: analysis.description,
        keywords: analysis.keywords,
        summary: analysis.summary,
        recommendations: analysis.recommendations,
        market_size_estimate: analysis.market_size_estimate,
        target_audience: analysis.target_audience,
        monetization_ideas: analysis.monetization_ideas,
        risks: analysis.risks
      };
    } catch (error) {
      console.error('AI analysis error:', error);
      throw new Error('Failed to analyze niche: ' + error.message);
    }
  }

  /**
   * Build comprehensive analysis prompt
   */
  buildNicheAnalysisPrompt(niche) {
    const painPointsSummary = niche.pain_points?.slice(0, 20).map(pp => 
      `- ${pp.title} (intensity: ${pp.intensity_score}, engagement: ${pp.upvotes + pp.comments})`
    ).join('\n') || 'No pain points data';

    const trendsSummary = niche.trends?.slice(0, 20).map(t => 
      `- ${t.title} (trending: ${t.trending_score}, growth: ${t.growth_rate}%)`
    ).join('\n') || 'No trends data';

    return `Analyze this niche opportunity and provide scores from 0-100 for each metric.

NICHE: ${niche.name}
CATEGORY: ${niche.category || 'Unknown'}
DISCOVERY MODE: ${niche.discovery_mode}

PAIN POINTS DETECTED (Top 20):
${painPointsSummary}

TRENDS DETECTED (Top 20):
${trendsSummary}

SOCIAL MENTIONS: ${niche.social_mentions?.length || 0} total mentions

Provide your analysis in JSON format with these fields:
{
  "opportunity_score": <0-100>,
  "competition_score": <0-100, higher = more competition>,
  "demand_score": <0-100>,
  "growth_score": <0-100>,
  "description": "<2-3 sentence niche description>",
  "keywords": ["<keyword1>", "<keyword2>", ...],
  "summary": "<comprehensive analysis paragraph>",
  "recommendations": ["<action1>", "<action2>", ...],
  "market_size_estimate": "<e.g., '10K-50K potential customers'>",
  "target_audience": "<who would buy/use this>",
  "monetization_ideas": ["<idea1>", "<idea2>", ...],
  "risks": ["<risk1>", "<risk2>", ...]
}

Consider:
1. Pain point intensity and frequency
2. Trend velocity and longevity
3. Engagement levels across platforms
4. Market saturation indicators
5. Monetization potential`;
  }

  /**
   * Analyze pain point severity and opportunity
   */
  async analyzePainPoint(painPointText, context = {}) {
    try {
      const prompt = `Analyze this pain point and score its severity:

PAIN POINT: "${painPointText}"
CONTEXT: ${JSON.stringify(context)}

Provide JSON response:
{
  "intensity_score": <0-100>,
  "frequency_score": <0-100>,
  "urgency_score": <0-100>,
  "market_size_score": <0-100>,
  "sentiment": "<positive|negative|neutral|mixed>",
  "sentiment_score": <-1 to 1>,
  "emotions": {"frustration": <0-1>, "urgency": <0-1>, "confusion": <0-1>},
  "keywords": ["<keyword1>", ...],
  "categories": ["<category1>", ...],
  "summary": "<brief analysis>"
}`;

      const completion = await this.groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are an expert at analyzing customer pain points and emotional signals.' },
          { role: 'user', content: prompt }
        ],
        model: this.model,
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });

      return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      console.error('Pain point analysis error:', error);
      return this.getDefaultPainPointScores();
    }
  }

  /**
   * Analyze trend potential
   */
  async analyzeTrend(trendTitle, trendData = {}) {
    try {
      const prompt = `Analyze this trend and score its potential:

TREND: "${trendTitle}"
DATA: ${JSON.stringify(trendData)}

Provide JSON response:
{
  "trending_score": <0-100>,
  "velocity_score": <0-100>,
  "longevity_score": <0-100>,
  "monetization_score": <0-100>,
  "keywords": ["<keyword1>", ...],
  "categories": ["<category1>", ...],
  "related_trends": ["<trend1>", ...],
  "summary": "<brief analysis>",
  "is_fad": <true|false>,
  "peak_estimate": "<when will this peak>"
}`;

      const completion = await this.groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are an expert at analyzing market trends and viral phenomena.' },
          { role: 'user', content: prompt }
        ],
        model: this.model,
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });

      return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      console.error('Trend analysis error:', error);
      return this.getDefaultTrendScores();
    }
  }

  /**
   * Extract keywords and themes from text
   */
  async extractKeywords(text, count = 10) {
    try {
      const completion = await this.groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'Extract the most important keywords and phrases from text. Return JSON array.'
          },
          {
            role: 'user',
            content: `Extract top ${count} keywords from: "${text.substring(0, 1000)}"`
          }
        ],
        model: this.model,
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(completion.choices[0].message.content);
      return result.keywords || [];
    } catch (error) {
      console.error('Keyword extraction error:', error);
      return [];
    }
  }

  /**
   * Classify social mention as pain point or trend
   */
  async classifyMention(content) {
    try {
      const prompt = `Classify this social media post:

"${content}"

Respond with JSON:
{
  "has_pain_point": <true|false>,
  "has_trend_signal": <true|false>,
  "sentiment": "<positive|negative|neutral|mixed>",
  "keywords": ["<keyword1>", ...],
  "category": "<category>",
  "confidence": <0-1>
}`;

      const completion = await this.groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'You classify social media content for market research.' },
          { role: 'user', content: prompt }
        ],
        model: this.model,
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      });

      return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      console.error('Classification error:', error);
      return { has_pain_point: false, has_trend_signal: false, confidence: 0 };
    }
  }

  /**
   * Batch analyze multiple items efficiently
   */
  async batchAnalyze(items, type = 'pain_point') {
    const batchSize = 10;
    const results = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const promises = batch.map(item => {
        if (type === 'pain_point') {
          return this.analyzePainPoint(item.content, item.context);
        } else if (type === 'trend') {
          return this.analyzeTrend(item.title, item.data);
        }
      });

      const batchResults = await Promise.allSettled(promises);
      results.push(...batchResults.map((r, idx) => ({
        item: batch[idx],
        result: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? r.reason : null
      })));

      // Rate limiting
      await this.sleep(1000);
    }

    return results;
  }

  /**
   * Generate niche report
   */
  async generateReport(niche) {
    try {
      const prompt = `Generate a comprehensive market research report for this niche:

NICHE: ${niche.name}
DESCRIPTION: ${niche.description}
SCORES:
- Opportunity: ${niche.opportunity_score}
- Competition: ${niche.competition_score}
- Demand: ${niche.demand_score}
- Growth: ${niche.growth_score}

DATA:
- ${niche.pain_points?.length || 0} pain points detected
- ${niche.trends?.length || 0} trends identified
- ${niche.social_mentions?.length || 0} social mentions

Generate a detailed markdown report with:
1. Executive Summary
2. Market Opportunity Analysis
3. Competition Assessment
4. Target Audience Profile
5. Key Pain Points
6. Trending Topics
7. Monetization Strategies
8. Risks & Challenges
9. Recommended Actions

Format as markdown.`;

      const completion = await this.groq.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are a professional market research analyst creating detailed reports.' },
          { role: 'user', content: prompt }
        ],
        model: this.model,
        temperature: 0.4,
        max_tokens: 4000
      });

      return completion.choices[0].message.content;
    } catch (error) {
      console.error('Report generation error:', error);
      throw error;
    }
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  normalizeScore(score) {
    if (typeof score !== 'number') return 0;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  getDefaultPainPointScores() {
    return {
      intensity_score: 50,
      frequency_score: 50,
      urgency_score: 50,
      market_size_score: 50,
      sentiment: 'neutral',
      sentiment_score: 0,
      emotions: {},
      keywords: [],
      categories: [],
      summary: 'Unable to analyze'
    };
  }

  getDefaultTrendScores() {
    return {
      trending_score: 50,
      velocity_score: 50,
      longevity_score: 50,
      monetization_score: 50,
      keywords: [],
      categories: [],
      related_trends: [],
      summary: 'Unable to analyze',
      is_fad: false,
      peak_estimate: 'Unknown'
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AIAnalysisService();
