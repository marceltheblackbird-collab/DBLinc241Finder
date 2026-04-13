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
    return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
  }

  try {
    // ── Step 1: Ask Claude (with live web search) to find current deals ──
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
        messages: [{
          role: "user",
          content: `Search the web now for bars, pubs, and cocktail venues in Lincoln, UK (Lincoln city centre and Brayford waterfront area) that currently advertise 2-for-1 cocktails, happy hour cocktail deals, or cocktail promotions.

Search for things like "2 for 1 cocktails Lincoln", "happy hour cocktails Lincoln", "cocktail deals Lincoln bars".

Then respond with ONLY a valid JSON array — no explanation, no markdown, just raw JSON like:
[
  {
    "name": "Venue Name",
    "address": "Full address, Lincoln",
    "deal": "Short deal description",
    "dealHours": "e.g. 5pm–8pm weekdays",
    "dealStart": 17,
    "dealEnd": 20,
    "source": "https://url-where-you-found-it.com"
  }
]

Rules:
- Only include venues with actual evidence of a current deal. Do not invent or guess.
- If you find no evidence for a venue having a deal, leave it out.
- Aim for 3–10 real results. Quality over quantity.
- dealStart and dealEnd are 24-hour integers (e.g. 17 and 20 for 5pm–8pm).
- If the deal runs all day or hours are unclear, use 12 and 23.`
        }]
      })
    });

    const aiData = await aiRes.json();

    // Extract text from response (may be after tool use blocks)
    let rawText = "";
    for (const block of (aiData.content || [])) {
      if (block.type === "text") rawText += block.text;
    }

    // Parse the JSON array out of the response
    let venues = [];
    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) venues = JSON.parse(match[0]);
    } catch (e) {
      console.error("JSON parse error:", e, "Raw:", rawText);
    }

    // ── Step 2: Geocode each venue address → lat/lng via Nominatim ──
    const geocoded = [];
    for (const v of venues) {
      try {
        const query = encodeURIComponent(`${v.name}, ${v.address}, Lincoln, UK`);
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
          { headers: { "User-Agent": "LincolnCocktailFinder/1.0" } }
        );
        const geoData = await geoRes.json();
        if (geoData.length > 0) {
          geocoded.push({
            ...v,
            lat: parseFloat(geoData[0].lat),
            lng: parseFloat(geoData[0].lon)
          });
        } else {
          // Try just the name + Lincoln if full address fails
          const fallback = encodeURIComponent(`${v.name}, Lincoln, UK`);
          const fallRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${fallback}&format=json&limit=1`,
            { headers: { "User-Agent": "LincolnCocktailFinder/1.0" } }
          );
          const fallData = await fallRes.json();
          if (fallData.length > 0) {
            geocoded.push({
              ...v,
              lat: parseFloat(fallData[0].lat),
              lng: parseFloat(fallData[0].lon)
            });
          }
        }
        // Small delay to be polite to Nominatim's free service
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error("Geocode error for", v.name, e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ venues: geocoded, count: geocoded.length })
    };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Search failed", detail: err.message })
    };
  }
};
