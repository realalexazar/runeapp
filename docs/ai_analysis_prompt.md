# Prompt for AI Analysis (Grok/Gemini/ChatGPT)

Copy and paste this prompt along with your data:

---

## Context

I'm building a newsletter digest system that uses LLM summarization. I'm iterating on the quality of summaries and need your analysis.

## What I'm Sending You

1. **Raw email data**: A dataset showing:
   - Newsletter name and subject
   - Full content length (characters)
   - Truncation status (whether content exceeds 10,000 characters)
   - First 5,000 characters of content preview

2. **Generated digests/summaries**: The actual LLM-generated summaries for each email (so you can compare outputs to source material)

3. **Current LLM prompt**: The exact prompt I'm using to generate summaries (you'll receive this separately)

## Questions I Need Answered

### Question 1: Truncation Analysis
Are we truncating too early at 10,000 characters, and is that reducing newsletter quality?

Please analyze:
- Which emails are being truncated (>10k chars)?
- Are important specifics (numbers, percentages, key details) likely being cut off?
- Should we increase the truncation limit? If so, to what?
- What's the trade-off between more context vs. cost/token usage?

### Question 2: Summary Quality vs. Source Material
Relative to the source material (which may be generic), are our digests well-composed or not?

Please analyze:
- Are summaries extracting the right information from the source?
- Are summaries adding helpful context/synthesis, or are they too generic?
- What specific improvements should we make to the prompt?
- Are there patterns in what the LLM is missing or over-emphasizing?

## What I Need

1. **Specific recommendations** with reasoning
2. **Concrete prompt improvements** (exact wording changes)
3. **Data-driven insights** (reference specific examples from the data)
4. **Trade-off analysis** (quality vs. cost, truncation limits, etc.)

Please be direct and actionable. I'm looking for practical next steps to improve summary quality.

---

**After sending this prompt, attach:**
- Your raw email data (CSV/Excel or formatted text)
- Your generated digests/summaries (so you can compare outputs to inputs)
- Your current LLM prompt (system + user prompt)
