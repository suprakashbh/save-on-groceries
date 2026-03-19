import { getIdToken } from "./auth";

const baseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  "https://2xtv24ztwk.execute-api.us-east-1.amazonaws.com/poc/chat";

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
