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

  const fallbackVenues = [
    {
      name: "Be At One Lincoln",
      address: "High Street, Lincoln",
      deal: "Cocktail deals, check venue",
      dealHours: "Check venue",
      dealStart: 12,
      dealEnd: 23,
      source: "https://www.designmynight.com/uk/pubs/lincoln/be-at-one-lincoln",
      lat: 53.2286,
      lng: -0.5416
    },
    {
      name: "Slug And Lettuce Lincoln",
      address: "Brayford Wharf North, Lincoln",
      deal: "2-for-1 cocktails, check venue",
      dealHours: "Check venue",
      dealStart: 12,
      dealEnd: 23,
      source: "https://www.slugandlettuce.co.uk/lincoln/offers/2-for-1-cocktails",
      lat: 53.2276,
      lng: -0.5474
    },
    {
      name: "Revolution Lincoln",
      address: "Brayford Wharf North, Lincoln",
      deal: "2-4-1 cocktails, check venue",
      dealHours: "Check venue",
      dealStart: 12,
      dealEnd: 23,
      source: "https://www.revolution-bars.co.uk/bar/lincoln",
      lat: 53.2279,
      lng: -0.5469
    }
  ];

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function geocodeVenue(v) {
    const attempts = [
      `${v.name}, ${v.address}, Lincoln, UK`,
      `${v.name}, Lincoln, UK`,
      `${v.address}, Lincoln, UK`
    ].filter(q => q && q.trim());

    for (const attempt of attempts) {
      try {
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
          return {
            ...v,
            lat: parseFloat(geoData[0].lat),
            lng: parseFloat(geoData[0].lon)
          };
        }
      } catch (e) {}
      await sleep(150);
    }

    return v.lat && v.lng ? v : null;
  }

  try {
    if (!ANTHROPIC_KEY) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          venues: fallbackVenues,
          count: fallbackVenues.length,
          sourceMode: "fallback_no_api_key"
        })
      };
    }

    const prompt = `Find cocktail deals in Lincoln, UK tonight. Return only a JSON array with name, address, deal, dealHours, dealStart, dealEnd, source. Focus on central Lincoln and Brayford. Include 2 for 1, 2-4-1, happy hour, or discounted cocktails. Do not invent venues.`;

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
        max_tokens: 300,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }]
      })
    });

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      const errorType = aiData?.error?.type || "";
      if (aiRes.status === 429 || errorType === "rate_limit_error" || errorType === "overloaded_error") {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            venues: fallbackVenues,
            count: fallbackVenues.length,
            sourceMode: "fallback_rate_limited"
          })
        };
      }

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
      if (block.type === "text" && block.text) rawText += block.text;
    }

    let venues = [];
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
      venues = JSON.parse(match[0]);
    }

    if (!Array.isArray(venues) || venues.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          venues: fallbackVenues,
          count: fallbackVenues.length,
          sourceMode: "fallback_empty_results"
        })
      };
    }

    const geocoded = [];
    for (const v of venues.slice(0, 8)) {
      const cleanVenue = {
        name: v.name || "Unknown venue",
        address: v.address || "Lincoln",
        deal: v.deal || "Cocktail deal",
        dealHours: v.dealHours || "Check venue",
        dealStart: Number.isInteger(v.dealStart) ? v.dealStart : 12,
        dealEnd: Number.isInteger(v.dealEnd) ? v.dealEnd : 23,
        source: v.source || ""
      };

      const geocodedVenue = await geocodeVenue(cleanVenue);
      if (geocodedVenue) geocoded.push(geocodedVenue);
      await sleep(150);
    }

    if (geocoded.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          venues: fallbackVenues,
          count: fallbackVenues.length,
          sourceMode: "fallback_geocode_failed"
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        venues: geocoded,
        count: geocoded.length,
        sourceMode: "live"
      })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        venues: fallbackVenues,
        count: fallbackVenues.length,
        sourceMode: "fallback_exception"
      })
    };
  }
};
