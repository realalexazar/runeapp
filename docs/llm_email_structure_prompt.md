# Prompt for ChatGPT/Gemini: Email Body Structure & LLM Output Management

**Use this prompt in ChatGPT or Gemini to get recommendations:**

---

I'm building a newsletter digest system that:
1. Fetches full email bodies (HTML/text) from Gmail API
2. Uses LLM (GPT-4o-mini) to generate summaries of newsletter content
3. Formats summaries into a digest email sent to users

**Current approach:**
- Store full HTML/text content temporarily
- Feed content to LLM for summarization
- Store summaries, discard full bodies after digest is sent

**Questions:**

1. **Email Body Structure:**
   - What's the best way to structure/preprocess email HTML before feeding to LLM?
   - Should I strip HTML tags and use plain text, or keep HTML structure?
   - How do I handle newsletters with complex layouts (tables, images, multiple sections)?
   - Should I extract main content vs. headers/footers/unsubscribe links?

2. **LLM Input Optimization:**
   - What's the optimal content length per newsletter for summarization? (Currently truncating at ~10k tokens)
   - Should I pre-process content (remove boilerplate, extract main article text) before sending to LLM?
   - How do I handle newsletters with multiple articles vs. single article newsletters?
   - Should I include email metadata (subject, sender) in the prompt, or just content?

3. **LLM Output Management:**
   - How do I ensure consistent, structured output from LLM (JSON format)?
   - What's the best prompt structure for batch summarization (10-15 newsletters at once)?
   - How do I handle edge cases (empty content, malformed HTML, very long newsletters)?
   - Should I validate/clean LLM output before storing?

4. **Cost & Performance:**
   - What's the most cost-effective approach (batch size, model choice)?
   - How do I balance quality vs. speed vs. cost?
   - Should I cache summaries if content hasn't changed?

5. **Production Considerations:**
   - How do I handle LLM failures gracefully?
   - Should I retry failed summaries or skip them?
   - How do I monitor summary quality over time?

Please provide specific recommendations, code examples if helpful, and best practices for each area.

---
