// n8n Code node. Fetches unread articles from FreshRSS across all
// categories. Applies source-authority weighting and a per-feed volume
// cap. Sorts by primary source first, then freshness. Marks fetched
// articles as read so the next run doesn't re-fetch them.
//
// Runs after: HTTP Request (FreshRSS ClientLogin) -> Code (extract auth token)

const categories = [
  "Astronomy", "Biology", "Chemistry", "Companies / Business",
  "Computer Science", "Culture", "Earth", "Economics", "Entertainment",
  "Facts/ Things to Know", "Geography & Maps", "History", "Mathematics",
  "Philosophy", "Physics", "Politics & Society", "Psychology", "Technology"
];

// Feed origin titles containing any of these strings count as
// primary or institutional sources. They sort ahead of everything else.
const PRIMARY_SOURCES = [
  "nasa", "nih.gov", "cdc.gov", "federal reserve", "noaa",
  "science.org", "nature.com", "smithsonian", "bbc", "reuters",
  "world history encyclopedia", "quanta", "mit news", "npr",
  "earthsky", "mongabay", "compound interest"
];

function sourceWeight(article) {
  const originTitle = (article.origin && article.origin.title || "").toLowerCase();
  return PRIMARY_SOURCES.some(s => originTitle.includes(s)) ? 0 : 1;
}

const authToken = $input.first().json.authToken;
const results = {};
const perFeedCap = 30; // max articles pulled from any single feed per run

for (const category of categories) {
  const encoded = encodeURIComponent(category);
  const url = `http://freshrss/api/greader.php/reader/api/0/stream/contents/user/-/label/${encoded}?n=200&xt=user/-/state/com.google/read`;

  try {
    const response = await this.helpers.httpRequest({
      method: "GET",
      url: url,
      headers: { "Authorization": `GoogleLogin auth=${authToken}` },
      json: true,
    });
    let articles = response.items || [];

    // Cap per individual feed so one high-volume source can't take
    // the whole category's fetch budget.
    const grouped = {};
    for (const a of articles) {
      const feedName = (a.origin && a.origin.title) || "unknown";
      if (!grouped[feedName]) grouped[feedName] = [];
      if (grouped[feedName].length < perFeedCap) grouped[feedName].push(a);
    }
    articles = Object.values(grouped).flat();

    // Primary sources first. Freshest within each tier.
    articles.sort((a, b) => {
      const w = sourceWeight(a) - sourceWeight(b);
      if (w !== 0) return w;
      return (b.published || 0) - (a.published || 0);
    });

    results[category] = articles;

    // Mark everything fetched as read so the next run only sees new content.
    const itemIds = articles.map(a => a.id).filter(Boolean);
    if (itemIds.length > 0) {
      const bodyParts = [`a=${encodeURIComponent("user/-/state/com.google/read")}`];
      for (const id of itemIds) {
        bodyParts.push(`i=${encodeURIComponent(id)}`);
      }
      const formBody = bodyParts.join("&");

      await this.helpers.httpRequest({
        method: "POST",
        url: "http://freshrss/api/greader.php/reader/api/0/edit-tag",
        headers: {
          "Authorization": `GoogleLogin auth=${authToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody,
      });
    }
  } catch (err) {
    results[category] = [];
  }
}

return [{ json: { results } }];
