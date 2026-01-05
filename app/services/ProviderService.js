// backend/app/services/ProviderService.js
// Stable provider setup - Nitter is optional fallback
// Primary viral sources: TikTok + Instagram (both FREE and STABLE)

const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class ProviderService {
  constructor() {
    this.providers = {
      reddit: this.fetchRedditPRAW.bind(this),        // FREE, STABLE ✅
      tiktok: this.fetchTikTok.bind(this),            // FREE, STABLE ✅ (Primary viral)
      instagram: this.fetchInstagramPicuki.bind(this), // FREE, STABLE ✅ (Primary viral)
      youtube: this.fetchYouTube.bind(this),          // FREE, STABLE ✅
      googletrends: this.fetchGoogleTrends.bind(this), // FREE, STABLE ✅
      x: this.fetchTwitterOptional.bind(this),        // OPTIONAL (tries Nitter, gracefully fails)
      pinterest: this.fetchPinterestApify.bind(this), // Verification only
      linkedin: this.fetchLinkedIn.bind(this),
      medium: this.fetchMedium.bind(this),
      beehiiv: this.fetchBeehiiv.bind(this)
    };

    // Nitter instances (optional - if they work, great! if not, no problem)
    this.nitterInstances = [
      'https://nitter.net',
      'https://nitter.it',
      'https://nitter.unixfox.eu',
      'https://nitter.fdn.fr'
    ];
    this.currentNitterIndex = 0;
    this.nitterWorkingStatus = true; // Assume working until proven otherwise
  }

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
      
      // For Nitter/Twitter, fail gracefully
      if (providerName === 'x') {
        console.log('⚠️  Twitter/X unavailable, continuing with other providers...');
        return []; // Empty array, not an error
      }
      
      throw error;
    }
  }

  // =====================================================
  // TWITTER/X - OPTIONAL (Graceful Degradation)
  // =====================================================

  async fetchTwitterOptional(query, credentials, filters) {
    // If Nitter is known to be broken, skip it entirely
    if (!this.nitterWorkingStatus) {
      console.log('⏭️  Nitter is disabled, skipping Twitter/X');
      return [];
    }

    try {
      console.log(`🐦 Attempting Twitter/X via Nitter (optional)...`);
      
      const results = [];
      const limit = filters.limit || 50;
      let tweets = null;

      // Try just the first 2 instances quickly
      for (let i = 0; i < 2; i++) {
        const instance = this.nitterInstances[i];

        try {
          tweets = await Promise.race([
            this.scrapeNitterInstance(instance, query, limit),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 5000) // 5 sec timeout
            )
          ]);
          
          if (tweets && tweets.length > 0) {
            console.log(`✅ Twitter/X: Got ${tweets.length} tweets from ${instance}`);
            break;
          }
        } catch (instanceError) {
          console.log(`  ✗ ${instance} failed, trying next...`);
          continue;
        }
      }

      // If no tweets found, mark Nitter as broken and move on
      if (!tweets || tweets.length === 0) {
        console.log('⚠️  Nitter unavailable. Disabling Twitter/X for this session.');
        this.nitterWorkingStatus = false;
        return [];
      }

      // Convert to standardized format
      for (const tweet of tweets) {
        results.push({
          platform_id: tweet.id,
          content: tweet.text,
          author: tweet.username,
          source_url: `https://twitter.com/${tweet.username}/status/${tweet.id}`,
          upvotes: tweet.likes || 0,
          comments: tweet.replies || 0,
          shares: tweet.retweets || 0,
          engagement_score: (tweet.likes || 0) + (tweet.retweets || 0) * 2 + (tweet.replies || 0),
          mention_type: 'post',
          posted_at: tweet.date || new Date().toISOString(),
          raw_data: { source: 'nitter' }
        });
      }

      return results;

    } catch (error) {
      console.log(`⚠️  Twitter/X fetch failed: ${error.message}`);
      this.nitterWorkingStatus = false; // Disable for this session
      return []; // Return empty, don't throw
    }
  }

  async scrapeNitterInstance(instance, query, limit) {
    const searchUrl = `${instance}/search?f=tweets&q=${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 5000
    });

    const $ = cheerio.load(response.data);
    const tweets = [];

    $('.timeline-item').each((i, element) => {
      if (tweets.length >= limit) return false;

      try {
        const $tweet = $(element);
        
        const username = $tweet.find('.username').first().text().trim().replace('@', '');
        const tweetLink = $tweet.find('.tweet-link').attr('href');
        const tweetId = tweetLink ? tweetLink.split('/').pop().replace('#m', '') : null;
        const text = $tweet.find('.tweet-content').text().trim();
        
        const statsText = $tweet.find('.tweet-stats').text();
        const likes = this.extractNumber(statsText, /(\d+(?:,\d+)*)\s*(?:Likes?|♥)/i);
        const retweets = this.extractNumber(statsText, /(\d+(?:,\d+)*)\s*(?:Retweets?|🔁)/i);
        const replies = this.extractNumber(statsText, /(\d+(?:,\d+)*)\s*(?:Replies?|💬)/i);

        if (username && tweetId && text) {
          tweets.push({
            id: tweetId,
            username,
            text,
            date: new Date().toISOString(),
            likes,
            retweets,
            replies
          });
        }
      } catch (parseError) {
        // Skip malformed tweets
      }
    });

    return tweets;
  }

  // =====================================================
  // REDDIT - PRAW (FREE, STABLE, PRIMARY)
  // =====================================================

  async fetchRedditPRAW(query, credentials, filters) {
    try {
      const results = [];
      const limit = filters.limit || 100;
      const timeFilter = filters.timeFilter || 'month';

      console.log(`🐍 Reddit via PRAW: "${query}"`);

      const hasPRAW = await this.isPythonPRAWAvailable();
      
      if (!hasPRAW) {
        throw new Error('PRAW not installed. Run: pip3 install praw');
      }

      const pythonScript = `
import praw
import json
from datetime import datetime

reddit = praw.Reddit(
    client_id="${credentials.clientId || process.env.REDDIT_CLIENT_ID}",
    client_secret="${credentials.clientSecret || process.env.REDDIT_CLIENT_SECRET}",
    user_agent="SkyPath/1.0"
)

results = []

for submission in reddit.subreddit('all').search("${query.replace(/"/g, '\\"')}", limit=${limit}, time_filter="${timeFilter}"):
    post = {
        'id': submission.id,
        'title': submission.title,
        'selftext': submission.selftext[:1000] if submission.selftext else '',
        'author': str(submission.author) if submission.author else 'deleted',
        'subreddit': submission.subreddit.display_name,
        'permalink': f"https://reddit.com{submission.permalink}",
        'score': submission.score,
        'num_comments': submission.num_comments,
        'created_utc': submission.created_utc
    }
    results.append(post)

print(json.dumps(results))
`;

      const { stdout } = await execAsync(
        `python3 -c '${pythonScript.replace(/'/g, "'\"'\"'")}'`,
        { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
      );

      const posts = JSON.parse(stdout);

      for (const post of posts) {
        results.push({
          platform_id: post.id,
          content: `${post.title}\n\n${post.selftext}`,
          author: post.author,
          source_url: post.permalink,
          community: post.subreddit,
          thread_title: post.title,
          upvotes: post.score,
          comments: post.num_comments,
          engagement_score: post.score + post.num_comments,
          mention_type: 'post',
          posted_at: new Date(post.created_utc * 1000).toISOString()
        });
      }

      console.log(`✅ Reddit: ${results.length} posts`);
      return results;

    } catch (error) {
      console.error('Reddit PRAW error:', error);
      throw new Error(`Reddit fetch failed: ${error.message}`);
    }
  }

  async isPythonPRAWAvailable() {
    try {
      await execAsync('python3 -c "import praw; print(\'ok\')"');
      return true;
    } catch {
      return false;
    }
  }

  // =====================================================
  // TIKTOK - PRIMARY VIRAL SOURCE (FREE, STABLE)
  // =====================================================

  async fetchTikTok(query, credentials, filters) {
    try {
      console.log(`🎵 TikTok (Python API): "${query}"`);
      
      const limit = filters.limit || 50;
      const results = [];

      // Check if TikTok API is available
      const hasTikTokApi = await this.isTikTokApiAvailable();
      
      if (!hasTikTokApi) {
        throw new Error('TikTok-Api not installed. Run: pip3 install TikTokApi playwright && playwright install chromium');
      }

      const pythonScript = `
import json
from TikTokApi import TikTokApi
import asyncio

async def search_tiktok():
    results = []
    async with TikTokApi() as api:
        async for video in api.search.videos("${query.replace(/"/g, '\\"')}", count=${limit}):
            video_data = {
                'id': video.id,
                'description': video.desc if hasattr(video, 'desc') else '',
                'author': video.author.username if hasattr(video, 'author') else 'unknown',
                'likes': video.stats.digg_count if hasattr(video, 'stats') else 0,
                'comments': video.stats.comment_count if hasattr(video, 'stats') else 0,
                'shares': video.stats.share_count if hasattr(video, 'stats') else 0,
                'views': video.stats.play_count if hasattr(video, 'stats') else 0,
                'created_time': video.create_time if hasattr(video, 'create_time') else 0
            }
            results.append(video_data)
    
    return results

results = asyncio.run(search_tiktok())
print(json.dumps(results))
`;

      const { stdout } = await execAsync(
        `python3 -c '${pythonScript.replace(/'/g, "'\"'\"'")}'`,
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
      );

      const videos = JSON.parse(stdout);

      for (const video of videos) {
        results.push({
          platform_id: video.id,
          content: video.description,
          author: video.author,
          source_url: `https://www.tiktok.com/@${video.author}/video/${video.id}`,
          upvotes: video.likes,
          comments: video.comments,
          shares: video.shares,
          views: video.views,
          engagement_score: video.likes + (video.comments * 2) + (video.shares * 3),
          mention_type: 'video',
          posted_at: video.created_time ? new Date(video.created_time * 1000).toISOString() : new Date().toISOString()
        });
      }

      console.log(`✅ TikTok: ${results.length} videos`);
      return results;

    } catch (error) {
      console.error('TikTok API error:', error);
      throw new Error(`TikTok fetch failed: ${error.message}`);
    }
  }

  async isTikTokApiAvailable() {
    try {
      await execAsync('python3 -c "from TikTokApi import TikTokApi; print(\'ok\')"');
      return true;
    } catch {
      return false;
    }
  }

  // =====================================================
  // INSTAGRAM - PRIMARY VIRAL SOURCE (FREE, STABLE)
  // =====================================================

  async fetchInstagramPicuki(query, credentials, filters) {
    try {
      console.log(`📸 Instagram via Picuki: "${query}"`);
      
      const limit = filters.limit || 50;
      const results = [];

      // Search hashtag on Picuki
      const hashtag = query.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const searchUrl = `https://www.picuki.com/tag/${hashtag}`;

      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      
      $('.photo-list .box-photo').each((i, element) => {
        if (results.length >= limit) return false;

        try {
          const $post = $(element);
          
          const postLink = $post.find('a').attr('href');
          const postId = postLink ? postLink.split('/').pop() : null;
          const imageUrl = $post.find('img').attr('src');
          const caption = $post.find('.photo-description').text().trim();
          
          const statsText = $post.find('.photo-stats').text();
          const likes = this.extractNumber(statsText, /(\d+(?:\.\d+)?[KM]?)\s*likes/i);
          const comments = this.extractNumber(statsText, /(\d+(?:\.\d+)?[KM]?)\s*comments/i);

          if (postId) {
            results.push({
              platform_id: postId,
              content: caption,
              author: 'unknown',
              source_url: `https://www.instagram.com/p/${postId}`,
              upvotes: likes,
              comments: comments,
              engagement_score: likes + (comments * 2),
              mention_type: 'post',
              posted_at: new Date().toISOString(),
              raw_data: { image_url: imageUrl }
            });
          }
        } catch (parseError) {
          // Skip malformed posts
        }
      });

      console.log(`✅ Instagram: ${results.length} posts`);
      return results;

    } catch (error) {
      console.error('Instagram Picuki error:', error);
      throw new Error(`Instagram fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // YOUTUBE (FREE, STABLE)
  // =====================================================

  async fetchYouTube(query, credentials, filters) {
    try {
      const apiKey = credentials.apiKey || process.env.YOUTUBE_API_KEY;
      const results = [];
      const limit = filters.limit || 50;

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
          engagement_score: parseInt(video.statistics.likeCount || 0) + parseInt(video.statistics.commentCount || 0) * 2,
          mention_type: 'video',
          posted_at: video.snippet.publishedAt
        });
      }

      console.log(`✅ YouTube: ${results.length} videos`);
      return results;

    } catch (error) {
      console.error('YouTube API error:', error);
      throw new Error(`YouTube fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // GOOGLE TRENDS (FREE, STABLE)
  // =====================================================

  async fetchGoogleTrends(query, credentials, filters) {
    try {
      const googleTrends = require('google-trends-api');
      const results = [];

      const interestData = await googleTrends.interestOverTime({
        keyword: query,
        startTime: filters.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        geo: filters.region || 'US'
      });

      const parsed = JSON.parse(interestData);

      results.push({
        platform_id: `trend_${Date.now()}`,
        content: `Google Trends data for: ${query}`,
        source_url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}`,
        engagement_score: parsed.default?.timelineData?.reduce((sum, t) => sum + (t.value[0] || 0), 0) || 0,
        mention_type: 'article',
        posted_at: new Date().toISOString(),
        raw_data: {
          timeline: parsed.default?.timelineData || []
        }
      });

      console.log(`✅ Google Trends: Data collected`);
      return results;

    } catch (error) {
      console.error('Google Trends error:', error);
      throw new Error(`Google Trends fetch failed: ${error.message}`);
    }
  }

  // =====================================================
  // PINTEREST (Verification Only via Apify)
  // =====================================================

  async fetchPinterestApify(query, credentials, filters) {
    // This should only be called by PinterestVerificationService
    // Not used in continuous scraping
    throw new Error('Pinterest is verification-only. Use PinterestVerificationService instead.');
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  extractNumber(text, regex) {
    if (!text) return 0;
    
    const match = text.match(regex);
    if (!match) return 0;
    
    const numStr = match[1].replace(/,/g, '');
    let num = parseFloat(numStr);
    
    if (text.includes('K') || text.includes('k')) {
      num *= 1000;
    } else if (text.includes('M') || text.includes('m')) {
      num *= 1000000;
    }
    
    return Math.floor(num);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ProviderService();
