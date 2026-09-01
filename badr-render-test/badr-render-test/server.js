const express = require("express");
const puppeteer = require("puppeteer-core");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const BASE_URL =
  "https://fo-emea.ttinteractive.com/zenith/frontoffice/badrairlines/en-GB/BookingEngine";

function validCode(value) {
  return /^[A-Z]{3}$/.test(value || "");
}

function extractFlightsFromText(text, origin, destination) {
  const times = text.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g) || [];
  const prices = text.match(/\$\s?[\d,.]+/g) || [];

  if (times.length < 2 || prices.length < 1) {
    return [];
  }

  return [
    {
      title: `بدر للطيران — ${origin} إلى ${destination}`,
      details: `الإقلاع: ${times[0]} — الوصول: ${times[1]}`,
      price: prices[prices.length - 1],
    },
  ];
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/search-badr", async (req, res) => {
  const origin = String(req.query.origin || "").toUpperCase();
  const destination = String(req.query.destination || "").toUpperCase();
  const date = String(req.query.date || "");
  const adults = Math.min(Math.max(Number(req.query.adults) || 1, 1), 9);

  if (
    !validCode(origin) ||
    !validCode(destination) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return res
      .status(400)
      .json({ message: "بيانات البحث غير مكتملة." });
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    );

    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const url = new URL(page.url());

    url.pathname = url.pathname.replace(
      /\/BookingEngine.*$/,
      "/BookingEngine/SearchResult"
    );

    url.search = new URLSearchParams({
      OriginAirportCode: origin,
      DestinationAirportCode: destination,
      OutboundDate: date,
      InboundDate: "",
      "TravelerTypes[0].Key": "AD",
      "TravelerTypes[0].Value": String(adults),
      "TravelerTypes[1].Key": "CHD",
      "TravelerTypes[1].Value": "0",
      "TravelerTypes[2].Key": "INF",
      "TravelerTypes[2].Value": "0",
      DiscountCode: "",
      Currency: "USD",
    }).toString();

    await page.goto(url.toString(), {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const body = await page.$eval("body", (element) => element.innerText);

    console.log("BADR PAGE TEXT:", body);

    if (/enable JS|ad blocker/i.test(body)) {
      throw new Error("تم رفض طلب البحث من موقع بدر.");
    }

    const flights = extractFlightsFromText(body, origin, destination);

    res.json({ flights });
  } catch (error) {
    console.error("Badr search failed:", error.message);

    res.status(502).json({
      message: "تعذر البحث في رحلات بدر الآن. يرجى المحاولة لاحقاً.",
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on ${PORT}`);
});
