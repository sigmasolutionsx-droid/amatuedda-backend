// backend/app/workers/skypath-worker.js
// STABLE configuration - focuses on reliable free providers
// Primary viral sources: TikTok + Instagram (where viral content actually happens!)

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const ProviderService = require('../services/ProviderService');
const AIAnalysisService = require('../services/AIAnalysisService');
const PinterestVerificationService = require('../services/PinterestVerificationService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class SkyPathWorker {
  constructor() {
    this.isRunning = false;
    this.stats = {
      totalScraped: 0,
      totalAnalyzed: 0,
      lastRun: null,
      errors: 0,
      providerSuccess: {
        reddit: 0,
        tiktok: 0,
        instagram: 0,
        youtube: 0,
        x: 0
      }
    };

    // Topics to monitor
    this.monitoredTopics = [
      'productivity',
      'startup',
      'fitness',
      'side hustle',
      'remote work',
      'finance',
      'marketing',
      'health',
      'relationships',
      'parenting',
      'technology',
      'education',
      'mental health',
      'sustainability',
      'home improvement'
    ];

    // Provider priority: STABLE sources first
    this.stableProviders = ['tiktok', 'instagram', 'reddit', 'youtube'];
    this.optionalProviders = ['x']; // Try but don't fail if unavailable
  }

  start() {
    console.log('🚀 SkyPath Background Worker starting...');
    console.log('📱 Primary viral sources: TikTok + Instagram');
    console.log('🔄 Stable providers: Reddit + YouTube');
    console.log('🐦 Optional: Twitter/X (via Nitter, may be unstable)');

    // Main scraping - every 10 minutes
    cron.schedule('*/10 * * * *', () => {
      this.runScrapingCycle();
    });

    // Pinterest verification - every hour
    cron.schedule('0 * * * *', () => {
      this.verifyViralTrends();
    });

    // Analytics - every hour
    cron.schedule('0 * * * *', () => {
      this.runAnalytics();
    });

    // Cleanup - daily at 2 AM
    cron.schedule('0 2 * * *', () => {
      this.cleanupOldData();
    });

    // Health check - every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.healthCheck();
    });

    // Run immediately
    setTimeout(() => this.runScrapingCycle(), 5000);

    console.log('✅ SkyPath Background Worker started');
  }

  async runScrapingCycle() {
    if (this.isRunning) {
      console.log('⏭️  Previous cycle still running, skipping...');
      return;
    }

    this.isRunning = true;
    this.stats.lastRun = new Date();

    console.log('\n🔄 Starting scraping cycle...');

    try {
      // Select 3 topics for this cycle
      const topicsToScrape = this.selectTopicsForCycle();

      for (const topic of topicsToScrape) {
        await this.scrapeAndAnalyzeTopic(topic);
      }

      console.log('✅ Scraping cycle completed');
      console.log(`📊 Stats: ${JSON.stringify(this.stats.providerSuccess, null, 2)}`);

    } catch (error) {
      console.error('❌ Scraping cycle error:', error);
      this.stats.errors++;
    } finally {
      this.isRunning = false;
    }
  }

  selectTopicsForCycle() {
    const hour = new Date().getHours();
    const topicsPerCycle = 3;
    const startIndex = (hour % this.monitoredTopics.length);
    
    const selected = [];
    for (let i = 0; i < topicsPerCycle; i++) {
      const index = (startIndex + i) % this.monitoredTopics.length;
      selected.push(this.monitoredTopics[index]);
    }

    return selected;
  }

  async scrapeAndAnalyzeTopic(topic) {
    console.log(`\n📡 Scraping topic: "${topic}"`);

    try {
      const providers = this.selectProvidersForCycle();
      console.log(`🔌 Using providers: ${providers.join(', ')}`);

      const allMentions = [];

      // Scrape from STABLE providers (required)
      for (const providerName of providers.filter(p => this.stableProviders.includes(p))) {
        try {
          const mentions = await ProviderService.fetchData(
            providerName,
            topic,
            {},
            { limit: 20, includeComments: false }
          );

          allMentions.push(...mentions);
          this.stats.providerSuccess[providerName]++;
          console.log(`  ✓ ${providerName}: ${mentions.length} mentions`);

        } catch (providerError) {
          console.error(`  ✗ ${providerName} failed:`, providerError.message);
          // For stable providers, this is concerning
        }
      }

      // Try OPTIONAL providers (best effort)
      for (const providerName of providers.filter(p => this.optionalProviders.includes(p))) {
        try {
          const mentions = await ProviderService.fetchData(
            providerName,
            topic,
            {},
            { limit: 20, includeComments: false }
          );

          if (mentions.length > 0) {
            allMentions.push(...mentions);
            this.stats.providerSuccess[providerName]++;
            console.log(`  ✓ ${providerName}: ${mentions.length} mentions (bonus!)`);
          } else {
            console.log(`  ⚠️  ${providerName}: unavailable (skipped)`);
          }

        } catch (providerError) {
          console.log(`  ⚠️  ${providerName}: unavailable (skipped)`);
          // For optional providers, this is expected sometimes
        }
      }

      if (allMentions.length === 0) {
        console.log(`  ⚠️  No mentions found for "${topic}"`);
        return;
      }

      // Store and analyze
      await this.storeMentions(allMentions);
      await this.analyzeMentions(allMentions);
      await this.extractNiches(allMentions, topic);

      this.stats.totalScraped += allMentions.length;

      console.log(`✅ Completed "${topic}": ${allMentions.length} mentions processed`);

    } catch (error) {
      console.error(`❌ Error scraping "${topic}":`, error);
    }
  }

  /**
   * Select providers with smart rotation
   * PRIORITY: TikTok + Instagram (viral sources)
   */
  selectProvidersForCycle() {
    const minute = new Date().getMinutes();

    // Always include TikTok and Instagram (primary viral sources)
    const providers = ['tiktok', 'instagram'];

    // Rotate through others
    if (minute % 30 === 0) {
      providers.push('reddit', 'youtube');
    } else if (minute % 30 === 10) {
      providers.push('youtube', 'reddit');
    } else if (minute % 30 === 20) {
      providers.push('reddit', 'x'); // Try X/Twitter if available
    }

    return providers;
  }

  async storeMentions(mentions) {
    try {
      const newMentions = [];

      for (const mention of mentions) {
        const { data: existing } = await supabase
          .from('social_mentions')
          .select('id')
          .eq('platform_id', mention.platform_id)
          .eq('provider_name', mention.provider_name)
          .single();

        if (!existing) {
          newMentions.push({
            ...mention,
            user_id: null,
            created_at: new Date().toISOString()
          });
        }
      }

      if (newMentions.length > 0) {
        const { error } = await supabase
          .from('social_mentions')
          .insert(newMentions);

        if (error) throw error;

        console.log(`  💾 Stored ${newMentions.length} new mentions`);
      } else {
        console.log(`  ⏭️  All mentions already in database`);
      }

    } catch (error) {
      console.error('Error storing mentions:', error);
    }
  }

  async analyzeMentions(mentions) {
    try {
      console.log(`  🤖 Analyzing ${mentions.length} mentions with AI...`);

      const batchSize = 10;
      let analyzed = 0;

      for (let i = 0; i < mentions.length; i += batchSize) {
        const batch = mentions.slice(i, i + batchSize);

        const analyzePromises = batch.map(async (mention) => {
          try {
            const classification = await AIAnalysisService.classifyMention(
              mention.content
            );

            await supabase
              .from('social_mentions')
              .update({
                sentiment: classification.sentiment,
                has_pain_point: classification.has_pain_point,
                has_trend_signal: classification.has_trend_signal,
                keywords: classification.keywords,
                analyzed_at: new Date().toISOString()
              })
              .eq('platform_id', mention.platform_id)
              .eq('provider_name', mention.provider_name);

            analyzed++;

            if (classification.has_pain_point) {
              await this.analyzePainPoint(mention, classification);
            }

            if (classification.has_trend_signal) {
              await this.analyzeTrend(mention, classification);
            }

          } catch (analysisError) {
            console.error(`Error analyzing mention ${mention.platform_id}:`, analysisError);
          }
        });

        await Promise.all(analyzePromises);
        await this.sleep(1000);
      }

      this.stats.totalAnalyzed += analyzed;
      console.log(`  ✓ Analyzed ${analyzed} mentions`);

    } catch (error) {
      console.error('Error analyzing mentions:', error);
    }
  }

  async analyzePainPoint(mention, classification) {
    try {
      const analysis = await AIAnalysisService.analyzePainPoint(
        mention.content,
        {
          provider: mention.provider_name,
          engagement: mention.engagement_score
        }
      );

      await supabase
        .from('pain_points')
        .insert({
          user_id: null,
          provider_name: mention.provider_name,
          title: mention.content.substring(0, 200),
          description: mention.content,
          source_url: mention.source_url,
          author: mention.author,
          community: mention.community,
          intensity_score: analysis.intensity_score,
          frequency_score: analysis.frequency_score,
          urgency_score: analysis.urgency_score,
          market_size_score: analysis.market_size_score,
          upvotes: mention.upvotes || 0,
          comments: mention.comments || 0,
          sentiment: analysis.sentiment,
          sentiment_score: analysis.sentiment_score,
          emotions: analysis.emotions,
          keywords: analysis.keywords,
          categories: analysis.categories,
          ai_summary: analysis.summary,
          posted_at: mention.posted_at,
          discovered_at: new Date().toISOString()
        });

    } catch (error) {
      console.error('Error analyzing pain point:', error);
    }
  }

  async analyzeTrend(mention, classification) {
    try {
      const analysis = await AIAnalysisService.analyzeTrend(
        mention.content,
        {
          provider: mention.provider_name,
          engagement: mention.engagement_score,
          views: mention.views
        }
      );

      await supabase
        .from('trends')
        .insert({
          user_id: null,
          provider_name: mention.provider_name,
          title: mention.content.substring(0, 200),
          description: mention.content,
          source_url: mention.source_url,
          hashtags: this.extractHashtags(mention.content),
          trending_score: analysis.trending_score,
          velocity_score: analysis.velocity_score,
          longevity_score: analysis.longevity_score,
          monetization_score: analysis.monetization_score,
          mentions_count: 1,
          engagement_count: mention.engagement_score,
          keywords: analysis.keywords,
          categories: analysis.categories,
          related_trends: analysis.related_trends,
          ai_summary: analysis.summary,
          detected_at: new Date().toISOString()
        });

    } catch (error) {
      console.error('Error analyzing trend:', error);
    }
  }

  async extractNiches(mentions, topic) {
    const categories = new Map();

    for (const mention of mentions) {
      const { data } = await supabase
        .from('social_mentions')
        .select('keywords, sentiment, has_pain_point, has_trend_signal')
        .eq('platform_id', mention.platform_id)
        .single();

      if (data && data.keywords && data.keywords.length > 0) {
        const category = data.keywords[0];

        if (!categories.has(category)) {
          categories.set(category, {
            painPoints: 0,
            trends: 0,
            totalEngagement: 0
          });
        }

        const cat = categories.get(category);
        if (data.has_pain_point) cat.painPoints++;
        if (data.has_trend_signal) cat.trends++;
        cat.totalEngagement += mention.engagement_score || 0;
      }
    }

    for (const [category, stats] of categories.entries()) {
      if (stats.painPoints > 2 || stats.trends > 2) {
        await this.upsertNiche(category, topic, stats);
      }
    }
  }

  async upsertNiche(category, topic, stats) {
    try {
      const { data: existing } = await supabase
        .from('niches')
        .select('id, opportunity_score, demand_score')
        .eq('name', category)
        .is('user_id', null)
        .single();

      const opportunityScore = Math.min(100, stats.painPoints * 10);
      const demandScore = Math.min(100, stats.totalEngagement / 100);

      if (existing) {
        await supabase
          .from('niches')
          .update({
            opportunity_score: Math.max(existing.opportunity_score, opportunityScore),
            demand_score: Math.max(existing.demand_score, demandScore),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('niches')
          .insert({
            user_id: null,
            name: category,
            description: `Niche related to ${topic}`,
            category: topic,
            opportunity_score: opportunityScore,
            demand_score: demandScore,
            discovery_mode: 'skypath',
            primary_provider: 'multiple',
            status: 'discovered',
            created_at: new Date().toISOString()
          });
      }

    } catch (error) {
      console.error('Error upserting niche:', error);
    }
  }

  /**
   * Verify strong viral trends with Pinterest
   */
  async verifyViralTrends() {
    try {
      console.log('\n🔍 Checking for trends to verify...');

      const { data: potentialTrends } = await supabase
        .from('trends')
        .select(`*, social_mentions!inner(*)`)
        .eq('is_verified', false)
        .gte('trending_score', 75)
        .order('trending_score', { ascending: false })
        .limit(5);

      let verified = 0;

      for (const trend of potentialTrends || []) {
        const trendData = {
          topic: trend.title,
          platform_count: new Set(trend.social_mentions.map(m => m.provider_name)).size,
          total_engagement: trend.social_mentions.reduce((sum, m) => sum + m.engagement_score, 0),
          velocity_score: trend.velocity_score,
          confidence: 0.85
        };

        if (await PinterestVerificationService.shouldVerify(trendData)) {
          console.log(`🔍 Verifying with Pinterest: "${trend.title}"`);
          
          const verification = await PinterestVerificationService.verifyTrend(
            trend.title,
            trend.keywords
          );

          await supabase
            .from('trends')
            .update({
              is_verified: verification.isVerified,
              pinterest_verification: verification
            })
            .eq('id', trend.id);

          if (verification.isVerified) verified++;
        }
      }

      if (verified > 0) {
        console.log(`✅ Verified ${verified} trends with Pinterest`);
      }

    } catch (error) {
      console.error('Error verifying viral trends:', error);
    }
  }

  async runAnalytics() {
    console.log('\n📊 Running analytics...');
    // ... existing analytics code ...
  }

  async cleanupOldData() {
    console.log('\n🧹 Cleaning up old data...');
    // ... existing cleanup code ...
  }

  async healthCheck() {
    try {
      const { error } = await supabase
        .from('social_mentions')
        .select('id')
        .limit(1);

      if (error) throw error;

      if (new Date().getMinutes() === 0) {
        console.log(`\n💓 Health Check - ${new Date().toISOString()}`);
        console.log(`  Total scraped: ${this.stats.totalScraped}`);
        console.log(`  Total analyzed: ${this.stats.totalAnalyzed}`);
        console.log(`  Provider success rates:`);
        for (const [provider, count] of Object.entries(this.stats.providerSuccess)) {
          console.log(`    - ${provider}: ${count} successful`);
        }
      }

    } catch (error) {
      console.error('❌ Health check failed:', error);
    }
  }

  extractHashtags(text) {
    if (!text) return [];
    const hashtags = text.match(/#[\w]+/g) || [];
    return hashtags.map(tag => tag.substring(1));
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const worker = new SkyPathWorker();
worker.start();

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down SkyPath worker...');
  process.exit(0);
});

module.exports = SkyPathWorker;
