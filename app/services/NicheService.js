// backend/app/services/NicheService.js
// Core niche discovery orchestration service

const { createClient } = require('@supabase/supabase-js');
const AIAnalysisService = require('./AIAnalysisService');
const ProviderService = require('./ProviderService');

class NicheService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }

  /**
   * Main discovery method - orchestrates entire niche finding process
   */
  async discoverNiches(userId, searchId, query, mode, providers, filters) {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Starting discovery: ${query} (${mode} mode)`);
      
      // Update search status
      await this.updateSearchStatus(searchId, 'running');

      // Step 1: Collect raw data from providers
      const rawData = await this.collectDataFromProviders(
        userId, 
        query, 
        providers, 
        filters
      );

      console.log(`📊 Collected ${rawData.length} mentions from providers`);

      // Step 2: Process and classify mentions
      const classified = await this.classifyMentions(rawData, mode);

      // Step 3: Extract niches from classified data
      const discoveredNiches = await this.extractNiches(
        userId,
        query,
        classified,
        mode
      );

      console.log(`✨ Discovered ${discoveredNiches.length} potential niches`);

      // Step 4: Score and rank niches
      const scoredNiches = await this.scoreNiches(discoveredNiches);

      // Step 5: Save everything to database
      const savedNiches = await this.saveDiscoveredNiches(
        userId,
        scoredNiches,
        classified
      );

      // Step 6: Update search query record
      const duration = Math.floor((Date.now() - startTime) / 1000);
      await this.updateSearchStatus(searchId, 'completed', {
        results_count: rawData.length,
        niches_discovered: savedNiches.length,
        pain_points_found: classified.painPoints.length,
        trends_found: classified.trends.length,
        duration_seconds: duration
      });

      console.log(`✅ Discovery completed in ${duration}s`);

      return savedNiches;

    } catch (error) {
      console.error('❌ Discovery failed:', error);
      
      // Update search with error
      await this.updateSearchStatus(searchId, 'failed', {
        error_message: error.message,
        duration_seconds: Math.floor((Date.now() - startTime) / 1000)
      });

      throw error;
    }
  }

  /**
   * Collect data from all enabled providers
   */
  async collectDataFromProviders(userId, query, requestedProviders, filters) {
    // Get user's available providers
    const { data: userProviders } = await this.supabase
      .from('user_providers')
      .select(`
        *,
        provider:providers(*)
      `)
      .eq('user_id', userId)
      .eq('is_enabled', true);

    // Filter to requested providers if specified
    let activeProviders = userProviders;
    if (requestedProviders.length > 0) {
      activeProviders = userProviders.filter(up => 
        requestedProviders.includes(up.provider.name)
      );
    }

    console.log(`🔌 Using ${activeProviders.length} providers`);

    // Collect data from each provider in parallel
    const providerPromises = activeProviders.map(async (userProvider) => {
      try {
        return await ProviderService.fetchData(
          userProvider.provider.name,
          query,
          userProvider.api_credentials,
          filters
        );
      } catch (error) {
        console.error(`Provider ${userProvider.provider.name} failed:`, error);
        
        // Log error to user_providers
        await this.supabase
          .from('user_providers')
          .update({
            error_count: userProvider.error_count + 1,
            last_error: error.message
          })
          .eq('id', userProvider.id);

        return [];
      }
    });

    const results = await Promise.all(providerPromises);
    
    // Flatten and add to social_mentions table
    const allMentions = results.flat();
    
    if (allMentions.length > 0) {
      await this.supabase
        .from('social_mentions')
        .insert(allMentions.map(m => ({
          ...m,
          user_id: userId
        })));
    }

    return allMentions;
  }

  /**
   * Classify mentions as pain points or trends using AI
   */
  async classifyMentions(mentions, mode) {
    const painPoints = [];
    const trends = [];
    const batchSize = 50;

    for (let i = 0; i < mentions.length; i += batchSize) {
      const batch = mentions.slice(i, i + batchSize);
      
      const classificationPromises = batch.map(async (mention) => {
        try {
          const classification = await AIAnalysisService.classifyMention(
            mention.content
          );

          // Update mention with classification
          await this.supabase
            .from('social_mentions')
            .update({
              has_pain_point: classification.has_pain_point,
              has_trend_signal: classification.has_trend_signal,
              sentiment: classification.sentiment,
              keywords: classification.keywords
            })
            .eq('id', mention.id);

          return {
            mention,
            classification
          };
        } catch (error) {
          console.error('Classification error:', error);
          return null;
        }
      });

      const classified = (await Promise.all(classificationPromises)).filter(Boolean);

      // Separate into pain points and trends based on mode
      for (const item of classified) {
        if (mode === 'skypath' || mode === 'hybrid') {
          if (item.classification.has_pain_point) {
            painPoints.push(item);
          }
        }
        
        if (mode === 'scoutfaire' || mode === 'hybrid') {
          if (item.classification.has_trend_signal) {
            trends.push(item);
          }
        }
      }

      // Rate limiting
      await this.sleep(1000);
    }

    return { painPoints, trends };
  }

  /**
   * Extract distinct niches from classified mentions
   */
  async extractNiches(userId, query, classified, mode) {
    const niches = new Map();

    // Process pain points
    for (const item of classified.painPoints) {
      const category = item.classification.category || 'Uncategorized';
      const key = category.toLowerCase();

      if (!niches.has(key)) {
        niches.set(key, {
          name: category,
          description: `Pain points related to ${category}`,
          category: category,
          discovery_mode: mode,
          primary_provider: item.mention.provider_name,
          painPoints: [],
          trends: []
        });
      }

      niches.get(key).painPoints.push(item);
    }

    // Process trends
    for (const item of classified.trends) {
      const category = item.classification.category || 'Uncategorized';
      const key = category.toLowerCase();

      if (!niches.has(key)) {
        niches.set(key, {
          name: category,
          description: `Trending topics in ${category}`,
          category: category,
          discovery_mode: mode,
          primary_provider: item.mention.provider_name,
          painPoints: [],
          trends: []
        });
      }

      niches.get(key).trends.push(item);
    }

    return Array.from(niches.values());
  }

  /**
   * Score each niche using AI analysis
   */
  async scoreNiches(niches) {
    const scored = [];

    for (const niche of niches) {
      try {
        // Basic scoring based on data
        const painPointScore = this.calculatePainPointScore(niche.painPoints);
        const trendScore = this.calculateTrendScore(niche.trends);

        niche.opportunity_score = (painPointScore + trendScore) / 2;
        niche.demand_score = this.calculateDemandScore(niche);
        niche.growth_score = this.calculateGrowthScore(niche);
        niche.competition_score = 50; // Default, can be enhanced

        scored.push(niche);
      } catch (error) {
        console.error('Scoring error:', error);
        scored.push(niche);
      }
    }

    return scored.sort((a, b) => 
      (b.opportunity_score || 0) - (a.opportunity_score || 0)
    );
  }

  /**
   * Save discovered niches and related data to database
   */
  async saveDiscoveredNiches(userId, niches, classified) {
    const savedNiches = [];

    for (const niche of niches) {
      try {
        // Insert or update niche
        const { data: savedNiche, error: nicheError } = await this.supabase
          .from('niches')
          .upsert({
            user_id: userId,
            name: niche.name,
            description: niche.description,
            category: niche.category,
            opportunity_score: niche.opportunity_score,
            demand_score: niche.demand_score,
            growth_score: niche.growth_score,
            competition_score: niche.competition_score,
            discovery_mode: niche.discovery_mode,
            primary_provider: niche.primary_provider,
            status: 'discovered'
          }, {
            onConflict: 'user_id,name'
          })
          .select()
          .single();

        if (nicheError) throw nicheError;

        // Save pain points
        if (niche.painPoints.length > 0) {
          const painPointsToInsert = niche.painPoints.map(pp => ({
            niche_id: savedNiche.id,
            user_id: userId,
            provider_name: pp.mention.provider_name,
            title: pp.mention.content.substring(0, 200),
            description: pp.mention.content,
            source_url: pp.mention.source_url,
            author: pp.mention.author,
            community: pp.mention.community,
            upvotes: pp.mention.upvotes || 0,
            comments: pp.mention.comments || 0,
            sentiment: pp.classification.sentiment,
            keywords: pp.classification.keywords,
            posted_at: pp.mention.posted_at,
            discovered_at: new Date().toISOString()
          }));

          await this.supabase
            .from('pain_points')
            .insert(painPointsToInsert);
        }

        // Save trends
        if (niche.trends.length > 0) {
          const trendsToInsert = niche.trends.map(t => ({
            niche_id: savedNiche.id,
            user_id: userId,
            provider_name: t.mention.provider_name,
            title: t.mention.content.substring(0, 200),
            description: t.mention.content,
            source_url: t.mention.source_url,
            keywords: t.classification.keywords,
            mentions_count: 1,
            engagement_count: (t.mention.upvotes || 0) + (t.mention.comments || 0),
            detected_at: new Date().toISOString()
          }));

          await this.supabase
            .from('trends')
            .insert(trendsToInsert);
        }

        savedNiches.push(savedNiche);

      } catch (error) {
        console.error('Error saving niche:', error);
      }
    }

    return savedNiches;
  }

  // =====================================================
  // SCORING HELPERS
  // =====================================================

  calculatePainPointScore(painPoints) {
    if (!painPoints || painPoints.length === 0) return 0;

    const avgEngagement = painPoints.reduce((sum, pp) => 
      sum + (pp.mention.upvotes || 0) + (pp.mention.comments || 0), 0
    ) / painPoints.length;

    const score = Math.min(100, (
      (painPoints.length * 2) + // Volume
      (avgEngagement / 10) + // Engagement
      (painPoints.filter(pp => pp.classification.confidence > 0.7).length * 3) // Confidence
    ));

    return Math.round(score);
  }

  calculateTrendScore(trends) {
    if (!trends || trends.length === 0) return 0;

    const avgEngagement = trends.reduce((sum, t) => 
      sum + (t.mention.upvotes || 0) + (t.mention.comments || 0), 0
    ) / trends.length;

    const score = Math.min(100, (
      (trends.length * 2) +
      (avgEngagement / 10) +
      (trends.filter(t => t.classification.confidence > 0.7).length * 3)
    ));

    return Math.round(score);
  }

  calculateDemandScore(niche) {
    const totalMentions = niche.painPoints.length + niche.trends.length;
    return Math.min(100, totalMentions * 5);
  }

  calculateGrowthScore(niche) {
    // Simple growth score based on recency
    const recentMentions = [...niche.painPoints, ...niche.trends].filter(item => {
      const age = Date.now() - new Date(item.mention.posted_at).getTime();
      return age < 7 * 24 * 60 * 60 * 1000; // Last 7 days
    });

    const growthRatio = recentMentions.length / Math.max(1, niche.painPoints.length + niche.trends.length);
    return Math.round(growthRatio * 100);
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  async updateSearchStatus(searchId, status, updates = {}) {
    await this.supabase
      .from('search_queries')
      .update({
        status,
        ...updates,
        ...(status === 'completed' && { completed_at: new Date().toISOString() })
      })
      .eq('id', searchId);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new NicheService();
