// n8n Code node. Takes the raw fetch results and assembles them into
// a single markdown digest. Cross-category dedup, skip-empty sections,
// full article text via a trafilatura receiver endpoint (with a
// timeout fallback to the RSS summary), per-section reading time, and
// a Quick Skim headline index at the top. Each Quick Skim entry links
// to an in-epub anchor for the full article plus a secondary external
// source link. Article counts per category are capped, with a higher
// cap for Entertainment and Facts.
//
// Runs after: Code (fetch-node.js). Output feeds an HTTP Request node
// that POSTs `digest` to the receiver's /receive-digest endpoint.

const results = $input.first().json.results;
const nowDate = new Date();
const today = nowDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
const now = nowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
const fileTimestamp = nowDate.toLocaleString('en-US', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York'
}).replace(/[/,: ]/g, '-').replace(/-+/g, '-');

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function estimateReadTime(text) {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

// Per-category article caps. Anything not listed here uses DEFAULT_LIMIT.
const CATEGORY_LIMITS = {
  "Facts/ Things to Know": 15,
  "Entertainment": 15,
};
const DEFAULT_LIMIT = 10;

const seenTitles = new Set();
const categorySections = [];
let allHeadlines = [];

for (const [category, articles] of Object.entries(results)) {
  if (!articles || articles.length === 0) continue;

  // Cross-category dedup. seenTitles is shared across the whole loop,
  // so a story covered by two different categories appears once.
  const deduped = [];
  for (const article of articles) {
    const norm = normalizeTitle(article.title || "");
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    deduped.push(article);
  }

  if (deduped.length === 0) continue; // skip empty sections entirely

  const limit = CATEGORY_LIMITS[category] || DEFAULT_LIMIT;
  const topArticles = deduped.slice(0, limit);
  const categorySlug = slugify(category);
  let sectionText = "";

  for (let idx = 0; idx < topArticles.length; idx++) {
    const article = topArticles[idx];
    const title = article.title || "Untitled";
    const link = (article.canonical && article.canonical[0]) ? article.canonical[0].href : "";
    const anchorId = `${categorySlug}-${idx + 1}`;

    let content = "";
    if (article.summary && article.summary.content) {
      content = article.summary.content;
    } else if (article.content && article.content.content) {
      content = article.content.content;
    }

    // Full article text via the receiver's trafilatura endpoint.
    // 8 second timeout, silent fallback to the RSS summary above.
    if (link) {
      try {
        const fullText = await this.helpers.httpRequest({
          method: "POST",
          url: "http://192.168.1.179:5000/extract",
          body: link,
          headers: { "Content-Type": "text/plain" },
          timeout: 8000,
        });
        if (fullText && fullText.length > content.length) {
          content = fullText;
        }
      } catch (e) {
        // extraction failed or timed out. keep the RSS summary.
      }
    }

    content = content.replace(/<[^>]*>/g, "").trim();

    // The /extract full-text pull sometimes repeats the title as its
    // first line. Strip that duplicate if present.
    if (content.toLowerCase().startsWith(title.toLowerCase())) {
      content = content.slice(title.length).trim();
    }

    if (content.length > 4000) {
      content = content.slice(0, 4000) + "...";
    }

    // Real heading with an explicit id, so pandoc emits a jumpable
    // anchor in the epub instead of plain bold text.
    sectionText += `### ${title} {#${anchorId}}\n\n`;
    if (content) sectionText += `${content}\n\n`;
    if (link) sectionText += `[Read more](${link})\n\n`;

    // Quick Skim: primary link jumps within the epub to the full
    // article. Secondary link goes straight to the original source.
    if (link) {
      allHeadlines.push(`- **${category}:** [${title}](#${anchorId}) ([source](${link}))`);
    } else {
      allHeadlines.push(`- **${category}:** [${title}](#${anchorId})`);
    }
  }

  const readTime = estimateReadTime(sectionText);
  const header = `## ${category} (${topArticles.length} articles, ~${readTime} min read)\n\n`;
  categorySections.push(header + sectionText + `---\n\n`);
}

let digest = `# Daily Knowledge Digest\n\n`;
digest += `**${today}, ${now} EST**\n\n---\n\n`;

digest += `## Quick Skim\n\n`;
if (allHeadlines.length > 0) {
  digest += allHeadlines.join('\n') + '\n\n';
} else {
  digest += `No new articles this run.\n\n`;
}
digest += `---\n\n`;

digest += categorySections.join('');

return [{ json: { digest, articleCount: allHeadlines.length, fileTimestamp } }];
