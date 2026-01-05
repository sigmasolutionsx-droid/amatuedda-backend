// backend/app/routes/niches.js
// SkyPath & Scout Faire Niche Finder Routes
// Add to your AmatuEdda server.js: app.use('/api/niches', require('./app/routes/niches'));

const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const NicheService = require('../services/NicheService');
const AIAnalysisService = require('../services/AIAnalysisService');

// =====================================================
// NICHES CRUD
// =====================================================

// Get all niches for authenticated user
router.get('/', authenticateUser, async (req, res) => {
  try {
    const { status, category, sort = 'score', limit = 50 } = req.query;
    const supabase = req.app.locals.supabase;
    
    let query = supabase
      .from('niches')
      .select(`
        *,
        pain_points:pain_points(count),
        trends:trends(count)
      `)
      .eq('user_id', req.user.id);
    
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    
    // Sorting
    const sortMap = {
      'score': ['overall_score', { ascending: false }],
      'date': ['created_at', { ascending: false }],
      'name': ['name', { ascending: true }]
    };
    const [sortField, sortOpts] = sortMap[sort] || sortMap.score;
    query = query.order(sortField, sortOpts);
    
    query = query.limit(limit);
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching niches:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single niche with details
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    const { data: niche, error } = await supabase
      .from('niches')
      .select(`
        *,
        pain_points(*),
        trends(*),
        analytics:niche_analytics(*)
      `)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) throw error;
    if (!niche) return res.status(404).json({ success: false, error: 'Niche not found' });
    
    res.json({ success: true, data: niche });
  } catch (error) {
    console.error('Error fetching niche:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new niche
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { name, description, category, tags, keywords } = req.body;
    const supabase = req.app.locals.supabase;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    
    const { data, error } = await supabase
      .from('niches')
      .insert({
        user_id: req.user.id,
        name,
        description,
        category,
        tags,
        keywords,
        status: 'discovered'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error creating niche:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update niche
router.patch('/:id', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    const updates = req.body;
    
    // Remove fields that shouldn't be directly updated
    delete updates.user_id;
    delete updates.created_at;
    
    const { data, error } = await supabase
      .from('niches')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Niche not found' });
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error updating niche:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete niche
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    const { error } = await supabase
      .from('niches')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Niche deleted' });
  } catch (error) {
    console.error('Error deleting niche:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// SEARCH & DISCOVERY
// =====================================================

// Discover new niches (SkyPath + Scout Faire)
router.post('/discover', authenticateUser, async (req, res) => {
  try {
    const { query, mode = 'hybrid', providers = [], filters = {} } = req.body;
    const supabase = req.app.locals.supabase;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }
    
    // Check user's search quota
    const { data: profile } = await supabase
      .from('profiles')
      .select('license_tier, search_quota_used, search_quota_reset_at')
      .eq('id', req.user.id)
      .single();
    
    const quotaLimits = { starter: 100, pro: 1000, enterprise: -1 };
    const userLimit = quotaLimits[profile.license_tier];
    
    if (userLimit !== -1 && profile.search_quota_used >= userLimit) {
      return res.status(429).json({ 
        success: false, 
        error: 'Search quota exceeded',
        quota_reset_at: profile.search_quota_reset_at 
      });
    }
    
    // Create search query record
    const { data: searchQuery, error: sqError } = await supabase
      .from('search_queries')
      .insert({
        user_id: req.user.id,
        query_text: query,
        search_mode: mode,
        providers,
        filters,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (sqError) throw sqError;
    
    // Increment quota
    await supabase
      .from('profiles')
      .update({ search_quota_used: profile.search_quota_used + 1 })
      .eq('id', req.user.id);
    
    // Start discovery process (async)
    NicheService.discoverNiches(req.user.id, searchQuery.id, query, mode, providers, filters)
      .catch(err => console.error('Discovery error:', err));
    
    res.json({ 
      success: true, 
      data: {
        search_id: searchQuery.id,
        status: 'running',
        message: 'Discovery started. Check back soon for results.'
      }
    });
  } catch (error) {
    console.error('Error starting discovery:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get search status
router.get('/search/:searchId', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    const { data, error } = await supabase
      .from('search_queries')
      .select('*')
      .eq('id', req.params.searchId)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Search not found' });
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching search:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// PAIN POINTS
// =====================================================

// Get pain points for a niche
router.get('/:nicheId/pain-points', authenticateUser, async (req, res) => {
  try {
    const { sort = 'intensity', limit = 50 } = req.query;
    const supabase = req.app.locals.supabase;
    
    let query = supabase
      .from('pain_points')
      .select('*')
      .eq('niche_id', req.params.nicheId)
      .eq('user_id', req.user.id);
    
    const sortMap = {
      'intensity': 'intensity_score',
      'frequency': 'frequency_score',
      'urgency': 'urgency_score',
      'date': 'discovered_at'
    };
    query = query.order(sortMap[sort] || 'intensity_score', { ascending: false });
    query = query.limit(limit);
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching pain points:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Validate pain point
router.post('/pain-points/:id/validate', authenticateUser, async (req, res) => {
  try {
    const { notes } = req.body;
    const supabase = req.app.locals.supabase;
    
    const { data, error } = await supabase
      .from('pain_points')
      .update({ 
        is_validated: true, 
        validation_notes: notes 
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error validating pain point:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// TRENDS
// =====================================================

// Get trends for a niche
router.get('/:nicheId/trends', authenticateUser, async (req, res) => {
  try {
    const { sort = 'trending', limit = 50 } = req.query;
    const supabase = req.app.locals.supabase;
    
    let query = supabase
      .from('trends')
      .select('*')
      .eq('niche_id', req.params.nicheId)
      .eq('user_id', req.user.id);
    
    const sortMap = {
      'trending': 'trending_score',
      'velocity': 'velocity_score',
      'monetization': 'monetization_score',
      'date': 'detected_at'
    };
    query = query.order(sortMap[sort] || 'trending_score', { ascending: false });
    query = query.limit(limit);
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// AI ANALYSIS
// =====================================================

// Analyze niche with AI
router.post('/:id/analyze', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    // Get niche with all data
    const { data: niche, error } = await supabase
      .from('niches')
      .select(`
        *,
        pain_points(*),
        trends(*),
        social_mentions(*)
      `)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) throw error;
    if (!niche) return res.status(404).json({ success: false, error: 'Niche not found' });
    
    // Update status
    await supabase
      .from('niches')
      .update({ status: 'analyzing' })
      .eq('id', req.params.id);
    
    // Perform AI analysis
    const analysis = await AIAnalysisService.analyzeNiche(niche);
    
    // Update niche with analysis results
    const { data: updated, error: updateError } = await supabase
      .from('niches')
      .update({
        opportunity_score: analysis.opportunity_score,
        competition_score: analysis.competition_score,
        demand_score: analysis.demand_score,
        growth_score: analysis.growth_score,
        description: analysis.description || niche.description,
        keywords: analysis.keywords || niche.keywords,
        status: 'validated'
      })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    res.json({ 
      success: true, 
      data: {
        niche: updated,
        analysis: analysis.summary
      }
    });
  } catch (error) {
    console.error('Error analyzing niche:', error);
    
    // Revert status on error
    const supabase = req.app.locals.supabase;
    await supabase
      .from('niches')
      .update({ status: 'discovered' })
      .eq('id', req.params.id);
    
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// MONITORING JOBS
// =====================================================

// Get user's monitoring jobs
router.get('/monitoring/jobs', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    const { data, error } = await supabase
      .from('monitoring_jobs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching monitoring jobs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create monitoring job
router.post('/monitoring/jobs', authenticateUser, async (req, res) => {
  try {
    const { name, niche_id, search_terms, providers, search_mode, schedule_cron } = req.body;
    const supabase = req.app.locals.supabase;
    
    const { data, error } = await supabase
      .from('monitoring_jobs')
      .insert({
        user_id: req.user.id,
        name,
        niche_id,
        search_terms,
        providers,
        search_mode,
        schedule_cron: schedule_cron || '0 */6 * * *', // Default: every 6 hours
        is_active: true,
        next_run_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error creating monitoring job:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle monitoring job
router.patch('/monitoring/jobs/:id/toggle', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    // Get current status
    const { data: job } = await supabase
      .from('monitoring_jobs')
      .select('is_active')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    
    // Toggle
    const { data, error } = await supabase
      .from('monitoring_jobs')
      .update({ is_active: !job.is_active })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error toggling job:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// ANALYTICS & STATS
// =====================================================

// Get dashboard stats
router.get('/stats/dashboard', authenticateUser, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    
    // Parallel queries for efficiency
    const [nichesResult, painPointsResult, trendsResult, quotaResult] = await Promise.all([
      supabase.from('niches').select('status').eq('user_id', req.user.id),
      supabase.from('pain_points').select('id').eq('user_id', req.user.id),
      supabase.from('trends').select('id').eq('user_id', req.user.id),
      supabase.from('profiles').select('license_tier, search_quota_used, search_quota_reset_at').eq('id', req.user.id).single()
    ]);
    
    const niches = nichesResult.data || [];
    const painPoints = painPointsResult.data || [];
    const trends = trendsResult.data || [];
    const quota = quotaResult.data;
    
    const stats = {
      total_niches: niches.length,
      validated_niches: niches.filter(n => n.status === 'validated').length,
      analyzing_niches: niches.filter(n => n.status === 'analyzing').length,
      total_pain_points: painPoints.length,
      total_trends: trends.length,
      search_quota: {
        used: quota.search_quota_used,
        limit: { starter: 100, pro: 1000, enterprise: -1 }[quota.license_tier],
        reset_at: quota.search_quota_reset_at
      }
    };
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export niche data
router.get('/:id/export', authenticateUser, async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    const supabase = req.app.locals.supabase;
    
    const { data, error } = await supabase
      .from('niches')
      .select(`
        *,
        pain_points(*),
        trends(*),
        analytics:niche_analytics(*)
      `)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Niche not found' });
    
    if (format === 'csv') {
      // Convert to CSV
      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="niche-${data.name.replace(/\s/g, '-')}.csv"`);
      res.send(csv);
    } else {
      res.json({ success: true, data });
    }
  } catch (error) {
    console.error('Error exporting niche:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function for CSV export
function convertToCSV(data) {
  // Simple CSV conversion - enhance as needed
  const headers = ['Name', 'Category', 'Score', 'Pain Points', 'Trends', 'Status'];
  const row = [
    data.name,
    data.category,
    data.overall_score,
    data.pain_points.length,
    data.trends.length,
    data.status
  ];
  return headers.join(',') + '\n' + row.join(',');
}

module.exports = router;
