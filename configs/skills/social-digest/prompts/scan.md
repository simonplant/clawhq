# Social Digest — Scan Prompt

Review social content for items worth surfacing.

## Priority Order
1. Direct mentions requiring a response (highest priority)
2. Replies from people in the user's contact list
3. Posts from explicitly tracked accounts that are substantive (not retweets, not engagement bait)

## Signal Test
Pass only if:
- The post is specific and from someone with real context (practitioner, peer, known contact)
- A reply or mention requires a response
- Content directly relates to a top-5 interest with genuine new information

Fail if:
- Engagement bait or viral content
- Generic takes
- Already seen in news-scanner

## Output
For mentions: "[account]: [summary] — response needed? [yes/no]"
For tracked accounts: "[account]: [one-sentence summary of what they said]"
If nothing clears: output nothing.
