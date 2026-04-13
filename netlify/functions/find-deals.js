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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    const prompt = `Find cocktail deals in Lincoln, UK available today or tonight.

Look for:
- 2 for 1 cocktails
- 2-4-1 cocktails
- happy hour cocktails
- discounted cocktails

Use venue websites, DesignMyNight, Instagram, Facebook, and local listings.

Return ONLY a JSON array:
[
  {
    "name": "Venue Name",
    "address": "Address if available",
    "deal": "Short deal description",
    "dealHours": "Hours if known, otherwise Check venue",
    "dealStart": 12,
    "dealEnd": 23,
    "source": "https://..."
  }
]

Rules:
- Lincoln city centre, Brayford Waterfront, and nearby central Lincoln only
- include 3 to 8 results if found
- if hours are unclear use "Check venue", 12, and 23
- do not invent venues`;

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
        max_tokens: 600,
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
        statusCode: aiRes.status || 500,
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

    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) {
        venues = JSON.parse(match[0]);
      }
    } catch (e) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Could not parse AI response",
          rawText
        })
      };
    }

    if (!Array.isArray(venues)) {
      venues = [];
    }

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
        ].filter(q => q && q.trim());

        let found = null;

        for (const attempt of attempts) {
          const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(attempt)}&format=json&limit=1`,
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

          await sleep(200);
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
      } catch (e) {
        // Skip failed venue
      }

      await sleep(200);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        venues: geocoded,
        count: geocoded.length
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
