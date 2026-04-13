exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "API key not configured" })
    };
  }

  try {
    const prompt = `Search the web for venues in Lincoln, UK that may offer cocktail deals, happy hour offers, 2-for-1 cocktails, discounted cocktails, student drinks deals, weekday drinks promotions, or similar offers.

Look across:
- bars
- pubs
- cocktail bars
- restaurants
- lounges
- clubs

Search using terms like:
- "cocktail deals Lincoln"
- "happy hour Lincoln"
- "2 for 1 cocktails Lincoln"
- "drinks deals Lincoln"
- "student nights Lincoln cocktails"
- "Brayford Lincoln bars offers"
- "Lincoln bar happy hour"

Include venues in:
- Lincoln city centre
- Brayford Waterfront
- uphill Lincoln if relevant
- nearby central Lincoln areas

Respond with ONLY a valid JSON array, no explanation, no markdown.

Format:
[
  {
    "name": "Venue Name",
    "address": "Full address if available",
    "deal": "Short deal description",
    "dealHours": "Deal hours if known",
    "dealStart": 17,
    "dealEnd": 20,
    "source": "https://url-where-you-found-it.com"
  }
]

Rules:
- Prefer real evidence from venue websites, booking platforms, Facebook pages, Instagram bios or posts, event listings, student listings, or local directories.
- If a venue appears to promote cocktails or happy hour but exact times are unclear, include it anyway and use:
  "dealHours": "Check venue"
  "dealStart": 12
  "dealEnd": 23
- If a source looks recent but not fully precise, include the venue rather than excluding it.
- Exclude clearly irrelevant or duplicate results.
- Aim for 5 to 15 results.
- Do not invent venues.
- Quality matters, but do not be overly strict.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Anthropic API call failed",
          detail: aiData
        })
      };
    }

    let rawText = "";
    for (const block of aiData.content || []) {
      if (block.type === "text" && block.text) {
        rawText += block.text;
      }
    }

    let venues = [];
    let parseError = null;

    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) {
        venues = JSON.parse(match[0]);
      }
    } catch (e) {
      parseError = e.message;
    }

    if (!Array.isArray(venues)) venues = [];

    const geocoded = [];

    for (const v of venues) {
      try {
        const name = v.name || "Unknown venue";
        const address = v.address || "";
        const deal = v.deal || "Cocktail deal";
        const dealHours = v.dealHours || "Check venue";
        const dealStart = Number.isInteger(v.dealStart) ? v.dealStart : 12;
        const dealEnd = Number.isInteger(v.dealEnd) ? v.dealEnd : 23;
        const source = v.source || "";

        const attempts = [
          `${name}, ${address}, Lincoln, UK`,
          `${name}, Lincoln, UK`,
          `${address}, Lincoln, UK`
        ].filter(Boolean);

        let found = null;

        for (const attempt of attempts) {
          const query = encodeURIComponent(attempt);
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
            {
              headers: {
                "User-Agent": "LincolnCocktailFinder/1.0"
              }
            }
          );

          const geoData = await geoRes.json();

          if (Array.isArray(geoData) && geoData.length > 0) {
            found = geoData[0];
            break;
          }

          await new Promise(r => setTimeout(r, 250));
        }

        if (found) {
          geocoded.push({
            name,
            address,
            deal,
            dealHours,
            dealStart,
            dealEnd,
            source,
            lat: parseFloat(found.lat),
            lng: parseFloat(found.lon)
          });
        }

        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        // swallow per venue
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        venues: geocoded,
        count: geocoded.length,
        debug: {
          rawText,
          parseError,
          aiReturnedCount: venues.length,
          geocodedCount: geocoded.length,
          parsedVenues: venues
        }
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Search failed",
        detail: err.message
      })
    };
  }
};
