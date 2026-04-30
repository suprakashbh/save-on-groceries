import { getIdToken } from "./auth";

const baseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  "https://2xtv24ztwk.execute-api.us-east-1.amazonaws.com/poc/chat";

const receiptAnalyzeUrl =
  import.meta.env.VITE_RECEIPT_ANALYZE_URL ||
  "https://t0rzf9jht6.execute-api.us-east-1.amazonaws.com/poc/receipt-analyze";

const userPreferencesUrl =
  import.meta.env.VITE_USER_PREFERENCES_URL ||
  "https://t0rzf9jht6.execute-api.us-east-1.amazonaws.com/poc/user-preferences";

const weeklyDealsUrl =
  import.meta.env.VITE_WEEKLY_DEALS_URL ||
  "https://2xtv24ztwk.execute-api.us-east-1.amazonaws.com/poc/weekly-deals";

const halfPriceDealsUrl =
  import.meta.env.VITE_HALF_PRICE_DEALS_URL ||
  "https://2xtv24ztwk.execute-api.us-east-1.amazonaws.com/poc/retrieve-half-price-deals";

export async function fetchDeals(message, sessionId) {
  const token = getIdToken();

  const payload = {
    message,
    sessionId
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const error = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(error || `Request failed: ${response.status}`);
  }

  return data;
}

export async function analyzeReceipt(file) {
  const token = getIdToken();

  const response = await fetch(receiptAnalyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "x-file-name": file.name,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: file
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.message || data?.details || JSON.stringify(data);
    throw new Error(message || `Receipt upload failed: ${response.status}`);
  }

  return data;
}

export async function saveUserPreferences(items) {
  const token = getIdToken();

  const response = await fetch(userPreferencesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ items })
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.message || data?.details || JSON.stringify(data);
    throw new Error(message || `Save failed: ${response.status}`);
  }

  return data;
}

export async function fetchWeeklyDeals() {
  const token = getIdToken();

  const response = await fetch(weeklyDealsUrl, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.message || data?.details || JSON.stringify(data);
    throw new Error(message || `Weekly deals request failed: ${response.status}`);
  }

  return data;
}

export async function fetchHalfPriceDeals({ week, provider }) {
  const token = getIdToken();
  const params = new URLSearchParams();

  if (week) {
    params.set("week", week);
  }

  if (provider && provider !== "all") {
    params.set("provider", provider);
  }

  const response = await fetch(`${halfPriceDealsUrl}?${params.toString()}`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.message || data?.details || JSON.stringify(data);
    throw new Error(message || `Half-price deals request failed: ${response.status}`);
  }

  return data;
}
