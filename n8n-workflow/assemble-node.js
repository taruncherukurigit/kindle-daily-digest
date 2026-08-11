// n8n Code node — takes the raw fetch results and assembles them into
// a single markdown digest: cross-category dedup, skip-empty sections,
// full article text via a trafilatura receiver endpoint (with a
// timeout fallback to the RSS summary), embedded images, per-section
// reading time, and a "Quick Skim" headline index at the top.
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

function estimateReadTime(text) {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

const seenTitles = new Set();
const categorySections = [];
let allHeadlines = [];

for (const [category, articles] of Object.entries(results)) {
  if (!articles || articles.length === 0) continue;

  // Cross-category dedup: seenTitles is shared across the whole loop,
  // so a story covered by two different categories only appears once.
  const deduped = [];
  for (const article of articles) {
    const norm = normalizeTitle(article.title || "");
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    deduped.push(article);
  }

  if (deduped.length === 0) continue; // skip-empty: no header for an empty section

  const topArticles = deduped.slice(0, 10);
  let sectionText = "";

  for (const article of topArticles) {
    const title = article.title || "Untitled";
    const link = (article.canonical && article.canonical[0]) ? article.canonical[0].href : "";

    let content = "";
    if (article.summary && article.summary.content) {
      content = article.summary.content;
    } else if (article.content && article.content.content) {
      content = article.content.content;
    }
    content = content.replace(/<[^>]*>/g, "").trim();

    // Full article text via the receiver's trafilatura endpoint.
    // 8s timeout with silent fallback to the RSS summary above.
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
        // extraction failed or timed out — keep the RSS summary
      }
    }

    if (content.length > 4000) {
      content = content.slice(0, 4000) + "...";
    }

    let imageUrl = "";
    if (article.enclosure && article.enclosure.length > 0) {
      imageUrl = article.enclosure[0].href || "";
    }

    sectionText += `**${title}**\n\n`;
    if (imageUrl) sectionText += `![](${imageUrl})\n\n`;
    if (content) sectionText += `${content}\n\n`;
    if (link) sectionText += `[Read more](${link})\n\n`;

    allHeadlines.push(`- **${category}:** ${title}`);
  }

  const readTime = estimateReadTime(sectionText);
  const header = `## ${category} (${topArticles.length} articles, ~${readTime} min read)\n\n`;
  categorySections.push(header + sectionText + `---\n\n`);
}

let digest = `# Daily Knowledge Digest\n\n`;
digest += `**${today} — ${now} EST**\n\n---\n\n`;

digest += `## Quick Skim\n\n`;
if (allHeadlines.length > 0) {
  digest += allHeadlines.join('\n') + '\n\n';
} else {
  digest += `No new articles this run.\n\n`;
}
digest += `---\n\n`;

digest += categorySections.join('');

return [{ json: { digest, articleCount: allHeadlines.length, fileTimestamp } }];
