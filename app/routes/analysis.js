const express = require('express');
const router = express.Router();
const { analyzeNiche } = require('../services/nicheAnalysis');

router.post('/signup-free', async (req, res) => {
  try {
    const { email } = req.body;
    const supabase = req.app.locals.supabase;
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'invalid_email' });
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .single();
    
    if (existing) {
      return res.json({
        success: true,
        userId: existing.id,
        isNewUser: false,
        tier: existing.tier,
        searches_remaining: existing.tier === 'free' ? 5 - existing.searches_used_this_month : 'unlimited'
      });
    }
    
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        tier: 'free',
        searches_used_this_month: 0,
        search_limit: 5,
        period_start: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Signup error:', error);
      return res.status(500).json({ success: false, error: 'signup_failed' });
    }
    
    return res.json({
      success: true,
      userId: newUser.id,
      isNewUser: true,
      tier: 'free',
      searches_remaining: 5,
      message: 'Account created! 5 free searches this month.'
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ success: false, error: 'signup_failed' });
  }
});

router.post('/niche', async (req, res) => {
  try {
    const { niche, userId } = req.body;
    const supabase = req.app.locals.supabase;
    
    if (!niche || !userId) {
      return res.status(400).json({ success: false, error: 'missing_params' });
    }
    
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (userError || !user) {
      return res.status(404).json({ success: false, error: 'user_not_found' });
    }
    
    // Reset monthly counter if needed
    const now = new Date();
    const periodStart = new Date(user.period_start);
    if (now.getMonth() !== periodStart.getMonth() || now.getFullYear() !== periodStart.getFullYear()) {
      await supabase.from('users').update({ 
        searches_used_this_month: 0, 
        period_start: now.toISOString() 
      }).eq('id', userId);
      user.searches_used_this_month = 0;
    }
    
    // Check limits for free tier
    if (user.tier === 'free' && user.searches_used_this_month >= 5) {
      return res.status(403).json({
        success: false,
        error: 'limit_reached',
        message: "You've used all 5 free searches this month",
        upgrade_url: '/upgrade'
      });
    }
    
    // Perform analysis with user tier
    console.log(`Analyzing: "${niche}" for user ${userId} (tier: ${user.tier})`);
    const result = await analyzeNiche(niche.trim(), user.tier);
    
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }
    
    // Increment counter
    await supabase.from('users').update({ 
      searches_used_this_month: user.searches_used_this_month + 1 
    }).eq('id', userId);
    
    // Store search history
    await supabase.from('user_searches').insert({
      user_id: userId,
      niche_query: niche.trim(),
      analysis_result: { scores: result.scores },
      model_used: result.model
    });
    
    const searchesUsed = user.searches_used_this_month + 1;
    
    return res.json({
      success: true,
      niche: niche.trim(),
      analysis: result.analysis,
      scores: result.scores,
      usage: {
        tier: user.tier,
        searches_used: searchesUsed,
        searches_remaining: user.tier === 'free' ? 5 - searchesUsed : 'unlimited'
      }
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ success: false, error: 'server_error' });
  }
});

module.exports = router;
