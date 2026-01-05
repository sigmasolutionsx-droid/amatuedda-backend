// backend/app/services/ProviderService.js
// Handles all social media provider integrations

const axios = require('axios');
const snoowrap = require('snoowrap'); // Reddit
const { TwitterApi } = require('twitter-api-v2'); // X/Twitter
// Add other provider SDKs as needed

class ProviderService {
  constructor() {
    this.providers = {
      reddit: this.fetchReddit.bind(this),
      x: this.fetchTwitter.bind(this),
      youtube: this.fetchYouTube.bind(this),
      googletrends: this.fetchGoogleTrends.bind(this),
      pinterest: this.fetchPinterest.bind(this),
      linkedin: this.fetchLinkedIn.bind(this),
      medium: this.fetchMedium.bind(this),
      instagram: this.fetchInstagram.bind(this),
      tiktok: this.fetchTikTok.bind(this),
      beehiiv: this.fetchBeehiiv.bind(this)
    };
  }

  /**
   * Main fetch method - routes to appropriate provider
   */
  async fetchData(providerName, query, credentials, filters = {}) {
    const fetchFunction = this.providers[providerName];
    
    if (!fetchFunction) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    console.log(`📡 Fetching from ${providerName}...`);
    
    try {
      const data = await fetchFunction(query, credentials, filters);
      return data.map(item => ({
        ...item,
        provider_name: providerName
      }));
    } catch (error) {
      console.error(`${providerName} fetch error:`, error.message);
      throw error;
    }
  }

  // =====================================================
  // REDDIT
  // =====================================================

  async fetchReddit(query, credentials, filters) {
    try {
      const reddit = new snoowrap({
        userAgent: 'SkyPath Niche Finder',
        clientId: credentials.clientId || process.env.REDDIT_CLIENT_ID,
        clientSecret: credentials.clientSecret || process.env.REDDIT_CLIENT_SECRET,
        username: credentials.username || process.env.REDDIT_USERNAME,
        password: credentials.password || process.env.REDDIT_PASSWORD
      });

      const results = [];
      const limit = filters.limit || 100;
      const timeFilter = filters.timeFilter || 'month'; // hour, day, week, month, year, all

      // Search posts
      const posts = await reddit.search({
        query,
        time: timeFilter,
        limit: Math.floor(limit * 0.7)
      });

      for (const post of posts) {
        results.push({
          platform_id: post.id,
          content: `${post.title}\n\n${post.selftext}`,
          author: post.author.name,
          source_url: `https://reddit.com${post.permalink}`,
          community: post.subreddit.display_name,
          thread_title: post.title,
          upvotes: post.ups,
          comments: post.num_comments,
          engagement_score: post.ups + post.num_comments,
          mention_type: 'post',
          posted_at: new Date(post.created_utc * 1000).toISOString(),
          raw_data: {
            score: post.score,
            upvote_ratio: post.upvote_ratio,
            gilded: post.gilded,
            over_18: post.over_18
          }
        });

        // Fetch top comments for additional context
        if (filters.includeComments && post.num_comments > 0) {
          try {
            await post.expandReplies({ limit: 5, depth: 1 });
            const topComments = post.comments.slice(0, 5);

            for (const comment of topComments) {
              if (comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]') {
                results.push({
                  platform_id: comment.id,
                  content: comment.body,
                  author: comment.author.name,
                  source_url: `https://reddit.com${comment.permalink}`,
                  community: post.subreddit.display_name,
                  parent_id: post.id,
                  thread_title: post.title,
                  upvotes: comment.ups,
                  comments: 0,
                  engagement_score: comment.ups,
                  mention_type: 'comment',
                  posted_at: new Date(comment.created_utc * 1000).toISOString(),
                  raw_data: { score: comment.score }
                });
              }
            }
          } catch (commentError) {
            console.error('Error fetching comments:', commentError);
          }
        }
      }

      return results;

    } catch (error) {
      console.error('Reddit API error:', error);
      throw new Error(`Reddit fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // X (TWITTER)
  // =====================================================

  async fetchTwitter(query, credentials, filters) {
    try {
      const client = new TwitterApi({
        appKey: credentials.apiKey || process.env.TWITTER_API_KEY,
        appSecret: credentials.apiSecret || process.env.TWITTER_API_SECRET,
        accessToken: credentials.accessToken || process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: credentials.accessSecret || process.env.TWITTER_ACCESS_SECRET
      });

      const results = [];
      const limit = filters.limit || 100;

      const tweets = await client.v2.search(query, {
        max_results: Math.min(limit, 100),
        'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'conversation_id'],
        'user.fields': ['username', 'name'],
        expansions: ['author_id']
      });

      for (const tweet of tweets.data) {
        const author = tweets.includes?.users?.find(u => u.id === tweet.author_id);
        
        results.push({
          platform_id: tweet.id,
          content: tweet.text,
          author: author?.username || 'unknown',
          source_url: `https://twitter.com/${author?.username}/status/${tweet.id}`,
          upvotes: tweet.public_metrics?.like_count || 0,
          comments: tweet.public_metrics?.reply_count || 0,
          shares: tweet.public_metrics?.retweet_count || 0,
          views: tweet.public_metrics?.impression_count || 0,
          engagement_score: (
            (tweet.public_metrics?.like_count || 0) +
            (tweet.public_metrics?.retweet_count || 0) * 2 +
            (tweet.public_metrics?.reply_count || 0)
          ),
          mention_type: 'post',
          posted_at: tweet.created_at,
          raw_data: {
            conversation_id: tweet.conversation_id,
            metrics: tweet.public_metrics
          }
        });
      }

      return results;

    } catch (error) {
      console.error('Twitter API error:', error);
      throw new Error(`Twitter fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // YOUTUBE
  // =====================================================

  async fetchYouTube(query, credentials, filters) {
    try {
      const apiKey = credentials.apiKey || process.env.YOUTUBE_API_KEY;
      const results = [];
      const limit = filters.limit || 50;

      // Search videos
      const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          part: 'snippet',
          q: query,
          type: 'video',
          maxResults: Math.min(limit, 50),
          order: filters.order || 'relevance',
          key: apiKey
        }
      });

      const videoIds = searchResponse.data.items.map(item => item.id.videoId).join(',');

      // Get video statistics
      const statsResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'statistics,snippet',
          id: videoIds,
          key: apiKey
        }
      });

      for (const video of statsResponse.data.items) {
        results.push({
          platform_id: video.id,
          content: `${video.snippet.title}\n\n${video.snippet.description}`,
          author: video.snippet.channelTitle,
          source_url: `https://www.youtube.com/watch?v=${video.id}`,
          community: video.snippet.channelTitle,
          thread_title: video.snippet.title,
          upvotes: parseInt(video.statistics.likeCount || 0),
          comments: parseInt(video.statistics.commentCount || 0),
          views: parseInt(video.statistics.viewCount || 0),
          engagement_score: (
            parseInt(video.statistics.likeCount || 0) +
            parseInt(video.statistics.commentCount || 0) * 2
          ),
          mention_type: 'video',
          posted_at: video.snippet.publishedAt,
          raw_data: {
            tags: video.snippet.tags,
            category: video.snippet.categoryId,
            statistics: video.statistics
          }
        });
      }

      // Optionally fetch comments for top videos
      if (filters.includeComments) {
        const topVideos = results.slice(0, 10);
        
        for (const video of topVideos) {
          try {
            const commentsResponse = await axios.get('https://www.googleapis.com/youtube/v3/commentThreads', {
              params: {
                part: 'snippet',
                videoId: video.platform_id,
                maxResults: 20,
                order: 'relevance',
                key: apiKey
              }
            });

            for (const thread of commentsResponse.data.items) {
              const comment = thread.snippet.topLevelComment.snippet;
              
              results.push({
                platform_id: thread.id,
                content: comment.textDisplay,
                author: comment.authorDisplayName,
                source_url: `https://www.youtube.com/watch?v=${video.platform_id}&lc=${thread.id}`,
                community: video.community,
                parent_id: video.platform_id,
                thread_title: video.thread_title,
                upvotes: comment.likeCount || 0,
                comments: thread.snippet.totalReplyCount || 0,
                engagement_score: comment.likeCount || 0,
                mention_type: 'comment',
                posted_at: comment.publishedAt,
                raw_data: { videoId: video.platform_id }
              });
            }
          } catch (commentError) {
            console.error('Error fetching YouTube comments:', commentError);
          }
        }
      }

      return results;

    } catch (error) {
      console.error('YouTube API error:', error);
      throw new Error(`YouTube fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // GOOGLE TRENDS
  // =====================================================

  async fetchGoogleTrends(query, credentials, filters) {
    try {
      const googleTrends = require('google-trends-api');
      const results = [];

      // Interest over time
      const interestData = await googleTrends.interestOverTime({
        keyword: query,
        startTime: filters.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        geo: filters.region || 'US'
      });

      const parsed = JSON.parse(interestData);
      
      // Related queries
      const relatedData = await googleTrends.relatedQueries({
        keyword: query,
        geo: filters.region || 'US'
      });

      const relatedParsed = JSON.parse(relatedData);

      // Format as mention
      results.push({
        platform_id: `trend_${Date.now()}`,
        content: `Google Trends data for: ${query}`,
        source_url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
        engagement_score: parsed.default?.timelineData?.reduce((sum, t) => sum + (t.value[0] || 0), 0) || 0,
        mention_type: 'article',
        posted_at: new Date().toISOString(),
        raw_data: {
          timeline: parsed.default?.timelineData || [],
          related_queries: relatedParsed.default?.rankedList || []
        }
      });

      return results;

    } catch (error) {
      console.error('Google Trends error:', error);
      throw new Error(`Google Trends fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // PINTEREST - Placeholder
  // =====================================================

  async fetchPinterest(query, credentials, filters) {
    // Pinterest API integration
    // Note: Pinterest API requires business account and approval
    console.warn('Pinterest integration not yet implemented');
    return [];
  }

  // =====================================================
  // LINKEDIN - Placeholder
  // =====================================================

  async fetchLinkedIn(query, credentials, filters) {
    // LinkedIn API integration
    console.warn('LinkedIn integration not yet implemented');
    return [];
  }

  // =====================================================
  // MEDIUM - Web Scraping (since no official API)
  // =====================================================

  async fetchMedium(query, credentials, filters) {
    try {
      // Medium doesn't have a public API, so we'll use RSS
      const Parser = require('rss-parser');
      const parser = new Parser();
      
      const results = [];
      const searchUrl = `https://medium.com/search/posts?q=${encodeURIComponent(query)}`;
      
      // Note: This is a simplified version. In production, consider using Medium's partner API
      // or a proper web scraping solution
      
      console.warn('Medium integration uses limited RSS - consider Medium Partner API for production');
      
      return results;

    } catch (error) {
      console.error('Medium fetch error:', error);
      return [];
    }
  }

  // =====================================================
  // INSTAGRAM - Placeholder
  // =====================================================

  async fetchInstagram(query, credentials, filters) {
    // Instagram Graph API integration
    console.warn('Instagram integration not yet implemented');
    return [];
  }

  // =====================================================
  // TIKTOK - Placeholder
  // =====================================================

  async fetchTikTok(query, credentials, filters) {
    // TikTok API integration
    console.warn('TikTok integration not yet implemented');
    return [];
  }

  // =====================================================
  // BEEHIIV - Placeholder
  // =====================================================

  async fetchBeehiiv(query, credentials, filters) {
    // Beehiiv API integration
    console.warn('Beehiiv integration not yet implemented');
    return [];
  }
}

module.exports = new ProviderService();
