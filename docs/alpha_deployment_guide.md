# Closed Alpha Deployment Guide

**Goal:** Get your MVP live so 2 friends can test it

---

## Option 1: Deploy to Vercel (Recommended) ⭐

**Time:** 15-20 minutes  
**Cost:** Free (Hobby plan is fine for alpha)

### Step 1: Push to GitHub
```bash
# If not already pushed
git push origin main
```

### Step 2: Connect to Vercel
1. Go to [vercel.com](https://vercel.com) and sign up/login with GitHub
2. Click "Add New Project"
3. Import your GitHub repo
4. Vercel auto-detects Next.js settings

### Step 3: Add Environment Variables
In Vercel project settings → Environment Variables, add:

**Required:**
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=sk-...
RESEND_API_KEY=re_...
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

**Optional (if you have service role key):**
```
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Step 4: Update Google OAuth Settings
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Open your OAuth 2.0 Client
3. Add authorized redirect URI:
   ```
   https://your-app.vercel.app/api/connect/gmail/callback
   ```
4. Save

### Step 5: Deploy
- Vercel auto-deploys on push
- Or click "Deploy" in Vercel dashboard
- Get your URL: `https://your-app.vercel.app`

### Step 6: Test
1. Visit your Vercel URL
2. Sign up with your email
3. Connect Gmail
4. Test the full flow

**Done!** Share the URL with your 2 friends.

---

## Option 2: ngrok (Quick Local Testing)

**Time:** 5 minutes  
**Use Case:** Quick testing without deploying

### Step 1: Install ngrok
```bash
# macOS
brew install ngrok

# Or download from ngrok.com
```

### Step 2: Start Your App
```bash
pnpm dev
# Runs on http://localhost:3000
```

### Step 3: Start ngrok Tunnel
```bash
ngrok http 3000
```

### Step 4: Update Google OAuth
1. Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)
2. Add to Google OAuth redirect URIs:
   ```
   https://abc123.ngrok.io/api/connect/gmail/callback
   ```

### Step 5: Share ngrok URL
- Share the ngrok URL with friends
- **Note:** Free ngrok URLs change on restart
- **Note:** Less stable than Vercel, but faster for quick tests

---

## Option 3: Cloudflare Tunnel (More Stable Than ngrok)

**Time:** 10 minutes  
**Use Case:** More stable than ngrok, still free

### Step 1: Install Cloudflare Tunnel
```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Or download from cloudflare.com/products/tunnel
```

### Step 2: Authenticate
```bash
cloudflared tunnel login
```

### Step 3: Create Tunnel
```bash
cloudflared tunnel create rune-alpha
```

### Step 4: Run Tunnel
```bash
cloudflared tunnel run rune-alpha
```

### Step 5: Update Google OAuth
- Use the Cloudflare tunnel URL
- Add to Google OAuth redirect URIs

---

## Environment Variables Checklist

Make sure you have all of these:

### Required for MVP:
- ✅ `NEXT_PUBLIC_SUPABASE_URL`
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- ✅ `OPENAI_API_KEY`
- ✅ `RESEND_API_KEY`
- ✅ `GOOGLE_CLIENT_ID`
- ✅ `GOOGLE_CLIENT_SECRET`

### Optional (but recommended):
- `SUPABASE_SERVICE_ROLE_KEY` (if using service role client)

---

## Google OAuth Setup Reminder

### Development (localhost):
```
http://localhost:3000/api/connect/gmail/callback
```

### Production (Vercel):
```
https://your-app.vercel.app/api/connect/gmail/callback
```

### ngrok/Cloudflare:
```
https://your-tunnel-url/api/connect/gmail/callback
```

**Important:** Add ALL redirect URIs you'll use to Google OAuth settings.

---

## Quick Test Checklist

After deployment, test:
1. ✅ Sign up works
2. ✅ Gmail OAuth connection works
3. ✅ Email backfill works
4. ✅ Newsletter classification works
5. ✅ Digest generation works
6. ✅ Email sending works (if implemented)

---

## Troubleshooting

### "Invalid redirect URI" Error
- Check Google OAuth settings
- Make sure exact URL matches (including https://)
- Wait 5 minutes after updating (Google caches)

### "Missing environment variables" Error
- Check Vercel environment variables
- Make sure all required vars are set
- Redeploy after adding vars

### Build Fails
- Check build logs in Vercel
- Common issues: missing env vars, TypeScript errors
- Run `pnpm build` locally first to catch errors

---

## Recommendation

**For closed alpha with 2 friends:**
- **Use Vercel** - It's free, stable, and easy
- Takes 15-20 minutes to set up
- Professional URL (your-app.vercel.app)
- Auto-deploys on git push
- Free SSL certificate

**ngrok/Cloudflare are fine for:**
- Quick local testing
- One-off demos
- When you don't want to deploy yet

---

## Next Steps After Alpha

1. **Collect Feedback:**
   - What worked well?
   - What broke?
   - What's confusing?

2. **Monitor:**
   - Check Vercel logs for errors
   - Monitor OpenAI API usage/costs
   - Check Supabase for data issues

3. **Iterate:**
   - Fix critical bugs
   - Improve UX based on feedback
   - Add missing features

4. **Scale:**
   - Add more users gradually
   - Monitor performance
   - Optimize costs

---

## Cost Estimates (Alpha Phase)

**Vercel:** Free (Hobby plan)  
**Supabase:** Free tier (500MB database, 2GB bandwidth)  
**OpenAI:** ~$0.003 per digest (gpt-4o-mini)  
**Resend:** Free tier (3,000 emails/month)  
**Google OAuth:** Free

**Total:** ~$0/month for alpha (unless you generate 1000+ digests)

---

## Security Notes for Alpha

- ✅ Use environment variables (never commit secrets)
- ✅ Vercel encrypts env vars at rest
- ✅ Use Supabase RLS policies
- ✅ Limit OAuth scopes (readonly for Gmail)
- ✅ Monitor API usage

---

**Ready to deploy? Start with Option 1 (Vercel) - it's the fastest path to a working alpha!**
