import { Fragment, useState } from "react";
import { fetchDeals } from "../api";
import { logout } from "../auth";

const sourceBaseUrl = import.meta.env.VITE_DEAL_SOURCE_BASE_URL || "";

function normalizeSourceValue(source) {
  return typeof source === "string" ? source.trim().replace(/^['"]|['"]$/g, "") : "";
}

function parseFieldLine(line) {
  const normalizedLine = line.replace(/^- /, "").trim();
  const separatorIndex = normalizedLine.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  const key = normalizedLine.slice(0, separatorIndex).trim();
  const value = normalizedLine.slice(separatorIndex + 1).trim();

  return key && value ? [key, value] : null;
}

function parseDealBlock(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((deal, line) => {
      const field = parseFieldLine(line);
      if (!field) return deal;

      const [key, value] = field;
      deal[key] = value;
      return deal;
    }, {});
}

function parseDealsResponse(responseText) {
  if (typeof responseText !== "string") {
    return null;
  }

  const normalized = responseText.trim();
  if (!normalized) {
    return null;
  }

  const [bestSection, otherSection = ""] = normalized.split(/\n\s*\nOther Deals:\s*\n/i);
  const bestMatch = bestSection.match(/Best Deal:\s*\n([\s\S]*)/i);

  if (!bestMatch) {
    return null;
  }

  const bestDeal = parseDealBlock(bestMatch[1]);
  const otherDeals = otherSection
    .split(/\n\s*\n/)
    .map((block) => parseDealBlock(block))
    .filter((deal) => Object.keys(deal).length > 0);

  return {
    bestDeal,
    otherDeals
  };
}

function toAssistantContent(data) {
  if (typeof data === "string") {
    return { kind: "text", text: data };
  }

  if (!data || typeof data !== "object") {
    return { kind: "text", text: String(data) };
  }

  let body = data.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  const responseText =
    typeof body?.response === "string"
      ? body.response
      : typeof data.response === "string"
        ? data.response
        : null;

  const parsedDeals = parseDealsResponse(responseText);
  if (parsedDeals) {
    return { kind: "deals", ...parsedDeals };
  }

  return {
    kind: "text",
    text: responseText || JSON.stringify(data, null, 2)
  };
}

function getSourceHref(source) {
  const normalizedSource = normalizeSourceValue(source);

  if (!normalizedSource) {
    return null;
  }

  if (/^https?:\/\//i.test(normalizedSource)) {
    return normalizedSource;
  }

  if (/^\/\//.test(normalizedSource)) {
    return `https:${normalizedSource}`;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(normalizedSource)) {
    return `https://${normalizedSource}`;
  }

  const base = sourceBaseUrl || window.location.origin;

  try {
    return new URL(normalizedSource, base).toString();
  } catch {
    return null;
  }
}

function SourceLink({ source }) {
  const label = normalizeSourceValue(source);
  const href = getSourceHref(source);

  if (!label) {
    return null;
  }

  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <a href={`https://www.google.com/search?q=${encodeURIComponent(label)}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function DealParagraph({ title, deal }) {
  if (!deal || Object.keys(deal).length === 0) {
    return null;
  }

  return (
    <p className="deal-paragraph">
      <span className="deal-title">{title}</span>{" "}
      {deal.Product ? <>{deal.Product} from </> : <>Deal from </>}
      {deal.Provider ? <span className="deal-provider">{deal.Provider}</span> : "an unknown provider"}
      {deal.Price ? <> at {deal.Price}</> : null}
      {deal.Promotion ? <>. Promotion: {deal.Promotion}</> : null}
      {deal.Source ? (
        <>
          . Source:{" "}
          <SourceLink source={deal.Source} />
        </>
      ) : null}
      .
    </p>
  );
}

function AssistantMessage({ content }) {
  if (content.kind !== "deals") {
    return <pre>{content.text}</pre>;
  }

  return (
    <div className="deal-message">
      <DealParagraph title="Best deal:" deal={content.bestDeal} />
      {content.otherDeals.length > 0 ? (
        <p className="deal-paragraph">
          <span className="deal-title">Other deals:</span>{" "}
          {content.otherDeals.map((deal, index) => {
            return (
              <Fragment key={`${deal.Provider || "provider"}-${deal.Source || index}-${index}`}>
                {index > 0 ? " " : null}
                {deal.Product ? `${deal.Product} from ` : ""}
                {deal.Provider ? <span className="deal-provider">{deal.Provider}</span> : "an unknown provider"}
                {deal.Price ? <> at {deal.Price}</> : null}
                {deal.Promotion ? <> with {deal.Promotion}</> : null}
                {deal.Source ? (
                  <>
                    {" "}(<SourceLink source={deal.Source} />)
                  </>
                ) : null}
                .
              </Fragment>
            );
          })}
        </p>
      ) : null}
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: {
        kind: "text",
        text: "Ask about weekly grocery deals. Example: Show me the deals on tea."
      }
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const data = await fetchDeals(text, sessionId);
      setMessages((prev) => [...prev, { role: "assistant", content: toAssistantContent(data) }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: { kind: "text", text: `Error: ${err.message || String(err)}` } }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page chat">
      <header className="topbar">
        <div>
          <div className="brand">Grocery Deals</div>
          <div className="subtitle">Powered by Bedrock Agent</div>
        </div>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <div className="chat-window">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "assistant" ? <AssistantMessage content={m.content} /> : <pre>{m.text}</pre>}
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Ask for a deal (e.g., tea, oats, wraps)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Searching…" : "Send"}
        </button>
      </form>
    </div>
  );
}
