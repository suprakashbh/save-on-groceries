import { Fragment, useState } from "react";
import { analyzeReceipt, fetchDeals, fetchWeeklyDeals, saveUserPreferences } from "../api";
import { getAccessToken, getIdToken, logout, parseJwtPayload } from "../auth";

const sourceBaseUrl = import.meta.env.VITE_DEAL_SOURCE_BASE_URL || "";
const weeklyDealProviders = ["coles", "woolworths"];

function normalizeSourceValue(source) {
  return typeof source === "string" ? source.trim().replace(/^['"]|['"]$/g, "") : "";
}

function normalizeDealsPayload(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.products)) {
    return null;
  }

  const products = data.products
    .map((product, productIndex) => {
      const productName = typeof product?.product === "string" ? product.product.trim() : "";
      const deals = Array.isArray(product?.deals)
        ? product.deals
            .map((deal, dealIndex) => ({
              id: `${productName || "product"}-${productIndex}-${dealIndex}`,
              dealType: typeof deal?.deal_type === "string" ? deal.deal_type.trim().toLowerCase() : "",
              description:
                typeof deal?.Description === "string"
                  ? deal.Description.trim()
                  : typeof deal?.description === "string"
                    ? deal.description.trim()
                    : "",
              provider: typeof deal?.provider === "string" ? deal.provider.trim() : "",
              price: deal?.price == null ? "" : String(deal.price),
              promotion: typeof deal?.promotion === "string" ? deal.promotion.trim() : "",
              source: typeof deal?.source === "string" ? deal.source.trim() : ""
            }))
            .filter((deal) => deal.description || deal.provider || deal.price || deal.promotion || deal.source)
        : [];

      if (!productName && deals.length === 0) {
        return null;
      }

      return {
        id: `${productName || "product"}-${productIndex}`,
        product: productName || `Product ${productIndex + 1}`,
        bestDeals: deals.filter((deal) => deal.dealType === "best"),
        otherDeals: deals.filter((deal) => deal.dealType !== "best")
      };
    })
    .filter(Boolean);

  return products.length > 0 ? { kind: "products", products } : null;
}

function parseJsonSafely(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractProductsPayload(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return Array.isArray(value.products) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = parseJsonSafely(value);
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.products)) {
    return parsed;
  }

  const resultMatch = value.match(/<result>\s*([\s\S]*?)\s*<\/result>/i);
  if (resultMatch?.[1]) {
    const resultPayload = parseJsonSafely(resultMatch[1]);
    if (resultPayload && typeof resultPayload === "object" && Array.isArray(resultPayload.products)) {
      return resultPayload;
    }
  }

  const productsIndex = value.indexOf('"products"');
  if (productsIndex >= 0) {
    const objectStart = value.lastIndexOf("{", productsIndex);
    const objectEnd = value.lastIndexOf("}");

    if (objectStart >= 0 && objectEnd > objectStart) {
      const candidate = parseJsonSafely(value.slice(objectStart, objectEnd + 1));
      if (candidate && typeof candidate === "object" && Array.isArray(candidate.products)) {
        return candidate;
      }
    }
  }

  return null;
}

function normalizeWeeklyDealsResponse(data) {
  const rawPayload =
    data && typeof data === "object" && "statusCode" in data
      ? data.statusCode === 200
        ? extractProductsPayload(parseJsonSafely(data.body)?.response)
        : null
      : extractProductsPayload(data);

  if (!rawPayload || typeof rawPayload !== "object" || !Array.isArray(rawPayload.products)) {
    return null;
  }

  let week = "";

  const products = rawPayload.products
    .map((product, productIndex) => {
      const productName = typeof product?.product === "string" ? product.product.trim() : "";
      const providerDeals = weeklyDealProviders.reduce(
        (acc, provider) => ({
          ...acc,
          [provider]: []
        }),
        {}
      );

      if (Array.isArray(product?.deals)) {
        product.deals.forEach((deal, dealIndex) => {
          const provider = typeof deal?.provider === "string" ? deal.provider.trim().toLowerCase() : "";

          if (!providerDeals[provider]) {
            return;
          }

          providerDeals[provider].push({
            id: `${productName || "product"}-${provider}-${productIndex}-${dealIndex}`,
            dealType: typeof deal?.deal_type === "string" ? deal.deal_type.trim().toLowerCase() : "",
            description:
              typeof deal?.Description === "string"
                ? deal.Description.trim()
                : typeof deal?.description === "string"
                  ? deal.description.trim()
                  : "",
            provider,
            price: typeof deal?.price === "number" ? deal.price : Number(deal?.price),
            promotion: typeof deal?.promotion === "string" ? deal.promotion.trim() : "",
            source: typeof deal?.source === "string" ? deal.source.trim() : "",
            week: typeof deal?.week === "string" ? deal.week.trim() : ""
          });

          if (!week && typeof deal?.week === "string" && deal.week.trim()) {
            week = deal.week.trim();
          }
        });
      }

      if (!productName && weeklyDealProviders.every((provider) => providerDeals[provider].length === 0)) {
        return null;
      }

      return {
        id: `${productName || "product"}-${productIndex}`,
        product: productName || `Product ${productIndex + 1}`,
        providers: providerDeals
      };
    })
    .filter(Boolean);

  return products.length > 0 ? products : null;
}

function formatProviderName(provider) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatPrice(price) {
  return Number.isFinite(price) ? `$${price.toFixed(2)}` : "N/A";
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

  let responsePayload = body?.response;
  if (typeof responsePayload === "string") {
    try {
      responsePayload = JSON.parse(responsePayload);
    } catch {
      responsePayload = null;
    }
  }

  const parsedDeals =
    normalizeDealsPayload(responsePayload) ||
    normalizeDealsPayload(body) ||
    normalizeDealsPayload(data);
  if (parsedDeals) {
    return parsedDeals;
  }

  return {
    kind: "text",
    text: JSON.stringify(responsePayload ?? body ?? data, null, 2)
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

function DealDetails({ deal }) {
  if (!deal) {
    return null;
  }

  return (
    <div className="deal-table" role="table">
      <div className="deal-row" role="row">
        <div className="deal-cell deal-label" role="cell">
          Description:
        </div>
        <div className="deal-cell" role="cell">
          {deal.description || "N/A"}
        </div>
      </div>
      <div className="deal-row" role="row">
        <div className="deal-cell deal-label" role="cell">
          Provider:
        </div>
        <div className="deal-cell deal-provider" role="cell">
          {deal.provider || "N/A"}
        </div>
      </div>
      <div className="deal-row" role="row">
        <div className="deal-cell deal-label" role="cell">
          Price:
        </div>
        <div className="deal-cell" role="cell">
          {deal.price ? `$${deal.price}` : "N/A"}
        </div>
      </div>
      <div className="deal-row" role="row">
        <div className="deal-cell deal-label" role="cell">
          Promotion:
        </div>
        <div className="deal-cell" role="cell">
          {deal.promotion || "N/A"}
        </div>
      </div>
      <div className="deal-row" role="row">
        <div className="deal-cell deal-label" role="cell">
          Source:
        </div>
        <div className="deal-cell" role="cell">
          {deal.source ? <SourceLink source={deal.source} /> : "N/A"}
        </div>
      </div>
    </div>
  );
}

function WeeklyDealCell({ deals }) {
  if (!Array.isArray(deals) || deals.length === 0) {
    return <span className="weekly-deals-empty">No deals</span>;
  }

  return (
    <div className="weekly-deal-list">
      {deals.map((deal) => (
        <article
          key={deal.id}
          className={`weekly-deal-card ${deal.dealType === "best" ? "best" : ""}`}
        >
          <div className="weekly-deal-header">
            <span className="weekly-deal-type">{deal.dealType === "best" ? "Best deal" : "Deal"}</span>
            <span className="weekly-deal-price">{formatPrice(deal.price)}</span>
          </div>
          <div className="weekly-deal-description">{deal.description || "N/A"}</div>
          <div className="weekly-deal-meta">
            <span>{deal.promotion || "No promotion details"}</span>
          </div>
          <div className="weekly-deal-meta">
            {deal.source ? <SourceLink source={deal.source} /> : <span>No source</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

function WeeklyDealsTable({ products, week }) {
  if (!Array.isArray(products) || products.length === 0) {
    return null;
  }

  return (
    <section className="weekly-deals-panel">
      {week ? <p className="receipt-meta">Week: {week}</p> : null}

      <div className="weekly-deals-table-wrap">
        <table className="weekly-deals-table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              {weeklyDealProviders.map((provider) => (
                <th key={provider} scope="col">
                  {formatProviderName(provider)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <th scope="row" className="weekly-deals-product">
                  {product.product}
                </th>
                {weeklyDealProviders.map((provider) => (
                  <td key={provider}>
                    <WeeklyDealCell deals={product.providers[provider]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssistantMessage({ content }) {
  if (content.kind !== "products") {
    return <pre>{content.text}</pre>;
  }

  return (
    <div className="deal-message">
      {content.products.map((product) => {
        const bestDeal = product.bestDeals[0] || null;

        return (
          <div key={product.id} className="deal-product-group">
            <div className="deal-section">
              <div className="deal-section-title">
                <span className="deal-title">Product:</span> {product.product}
              </div>
            </div>
            <div className="deal-section">
              <div className="deal-section-title">Best Deal</div>
              <DealDetails deal={bestDeal} />
            </div>
            {product.otherDeals.length > 0 ? (
              <div className="deal-section deal-section-spaced">
                <div className="deal-section-title">Other Deals</div>
                {product.otherDeals.map((deal, index) => (
                  <Fragment key={deal.id}>
                    <DealDetails deal={deal} />
                    {index < product.otherDeals.length - 1 ? <div className="deal-entry-gap" /> : null}
                  </Fragment>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function normalizeReceiptItems(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.receipts)) {
    return [];
  }

  return data.receipts.flatMap((receipt, receiptIndex) => {
    if (!Array.isArray(receipt?.items)) {
      return [];
    }

    return receipt.items.map((item, itemIndex) => ({
      id: `${receipt.file_name || "receipt"}-${receiptIndex}-${itemIndex}`,
      productName: "",
      description: typeof item?.description === "string" ? item.description : "",
      price: item?.price == null ? "" : String(item.price),
      lastProvider: "",
      preferredKeywords: ""
    }));
  });
}

function createEmptyReceiptItem() {
  return {
    id: crypto.randomUUID(),
    productName: "",
    description: "",
    price: "",
    lastProvider: "",
    preferredKeywords: ""
  };
}

function resolveUserIdFromTokens() {
  const accessTokenPayload = parseJwtPayload(getAccessToken());

  if (typeof accessTokenPayload?.name === "string" && accessTokenPayload.name.trim()) {
    return accessTokenPayload.name.trim();
  }

  const idTokenPayload = parseJwtPayload(getIdToken());
  const candidates = [
    idTokenPayload?.name,
    accessTokenPayload?.username,
    idTokenPayload?.["cognito:username"],
    idTokenPayload?.preferred_username,
    idTokenPayload?.email,
    accessTokenPayload?.sub,
    idTokenPayload?.sub
  ];

  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "supra123";
}

function ReceiptItemsTable({ items, onChange, onAddRow, onDeleteRow, onSave, saveLoading }) {
  if (items.length === 0) {
    return (
      <div className="receipt-results">
        <div className="receipt-results-header">
          <div>
            <h2>Receipt Items</h2>
            <p>Add products manually or upload a receipt to prefill rows.</p>
          </div>
        </div>
        <div className="receipt-actions">
          <button className="ghost" type="button" onClick={onAddRow}>
            Add row
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="receipt-results">
      <div className="receipt-results-header">
        <div>
          <h2>Receipt Items</h2>
          <p>
            Review extracted rows, add products manually, and enter preferred keywords separated by commas such as
            "wireless", "bluetooth", "noise-canceling".
          </p>
        </div>
        <div className="receipt-actions">
          <button className="ghost" type="button" onClick={onAddRow}>
            Add row
          </button>
          <button className="primary" type="button" onClick={onSave} disabled={saveLoading}>
            {saveLoading ? "Saving…" : "Save products"}
          </button>
        </div>
      </div>

      <div className="receipt-table-wrap">
        <table className="receipt-table">
          <thead>
            <tr>
              <th scope="col">Product name</th>
              <th scope="col">Description</th>
              <th scope="col">Last provider</th>
              <th scope="col">Preferred keywords</th>
              <th scope="col">Price</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td>
                  <input
                    type="text"
                    value={item.productName}
                    onChange={(e) => onChange(index, "productName", e.target.value)}
                    placeholder="Enter product name"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => onChange(index, "description", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.lastProvider}
                    onChange={(e) => onChange(index, "lastProvider", e.target.value)}
                    placeholder="Enter store or seller"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.preferredKeywords}
                    onChange={(e) => onChange(index, "preferredKeywords", e.target.value)}
                    placeholder='"wireless", "bluetooth", "noise-canceling"'
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={item.price}
                    onChange={(e) => onChange(index, "price", e.target.value)}
                  />
                </td>
                <td>
                  <button className="ghost row-action" type="button" onClick={() => onDeleteRow(item.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Chat() {
  const [selectedFeature, setSelectedFeature] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptItems, setReceiptItems] = useState([]);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [receiptExpanded, setReceiptExpanded] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [weeklyDealsLoading, setWeeklyDealsLoading] = useState(false);
  const [weeklyDealsError, setWeeklyDealsError] = useState("");
  const [weeklyDealsProducts, setWeeklyDealsProducts] = useState([]);
  const [weeklyDealsWeek, setWeeklyDealsWeek] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());
  const hasExpandedContent =
    messages.length > 0 ||
    (selectedFeature === "receipt" && (receiptExpanded || receiptItems.length > 0 || Boolean(receiptError))) ||
    (selectedFeature === "weeklyDeals" &&
      (weeklyDealsProducts.length > 0 || Boolean(weeklyDealsError) || weeklyDealsLoading));

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

  function handleReceiptFileChange(e) {
    const nextFile = e.target.files?.[0] || null;
    setReceiptError("");
    setSaveMessage("");

    if (!nextFile) {
      setReceiptFile(null);
      return;
    }

    if (!["image/jpeg", "image/png"].includes(nextFile.type)) {
      setReceiptFile(null);
      setReceiptError("Please upload a JPEG or PNG receipt image.");
      return;
    }

    setReceiptFile(nextFile);
  }

  async function handleReceiptUpload(e) {
    e.preventDefault();

    if (!receiptFile) {
      setReceiptError("Select a receipt image before uploading.");
      return;
    }

    setReceiptLoading(true);
    setReceiptError("");
    setSaveMessage("");

    try {
      const data = await analyzeReceipt(receiptFile);
      const items = normalizeReceiptItems(data);

      if (items.length === 0) {
        setReceiptError("The receipt was processed, but no items were returned.");
      } else {
        setReceiptItems((prev) => [...prev, ...items]);
      }
    } catch (err) {
      setReceiptError(err.message || "Receipt upload failed.");
    } finally {
      setReceiptLoading(false);
    }
  }

  function handleReceiptItemChange(index, field, value) {
    setSaveMessage("");
    setReceiptItems((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value
            }
          : item
      )
    );
  }

  function handleAddReceiptRow() {
    setReceiptExpanded(true);
    setReceiptError("");
    setSaveMessage("");
    setReceiptItems((prev) => [...prev, createEmptyReceiptItem()]);
  }

  function handleDeleteReceiptRow(itemId) {
    setReceiptError("");
    setSaveMessage("");
    setReceiptItems((prev) => prev.filter((item) => item.id !== itemId));
  }

  async function handleSaveProducts() {
    setReceiptError("");
    setSaveMessage("");

    const userId = resolveUserIdFromTokens();

    const itemsToSave = receiptItems
      .map((item) => ({
        user_id: userId,
        product_name: item.productName.trim(),
        product_description: item.description.trim(),
        last_provider: item.lastProvider.trim(),
        preferred_keywords: item.preferredKeywords
          .split(",")
          .map((keyword) => keyword.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean)
      }))
      .filter((item) => item.product_name || item.product_description || item.last_provider || item.preferred_keywords.length > 0);

    if (itemsToSave.length === 0) {
      setReceiptError("Add at least one product row before saving.");
      return;
    }

    const invalidItem = itemsToSave.find((item) => !item.product_name);
    if (invalidItem) {
      setReceiptError("Each saved row must include a product name.");
      return;
    }

    setSaveLoading(true);

    try {
      await saveUserPreferences(itemsToSave);
      setSaveMessage(`Saved ${itemsToSave.length} product${itemsToSave.length === 1 ? "" : "s"} successfully.`);
    } catch (err) {
      setReceiptError(err.message || "Saving products failed.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleGenerateWeeklyDeals() {
    setWeeklyDealsLoading(true);
    setWeeklyDealsError("");

    try {
      const data = await fetchWeeklyDeals();
      const products = normalizeWeeklyDealsResponse(data);

      if (!products) {
        setWeeklyDealsProducts([]);
        setWeeklyDealsWeek("");
        setWeeklyDealsError("Unable to load weekly deals. Please try again.");
        return;
      }

      setWeeklyDealsProducts(products);
      const firstWeek =
        products.flatMap((product) => weeklyDealProviders.flatMap((provider) => product.providers[provider] || []))[0]
          ?.week || "";
      setWeeklyDealsWeek(firstWeek);
    } catch {
      setWeeklyDealsProducts([]);
      setWeeklyDealsWeek("");
      setWeeklyDealsError("Unable to load weekly deals. Please try again.");
    } finally {
      setWeeklyDealsLoading(false);
    }
  }

  return (
    <div className="page chat">
      <header className="topbar">
        <div>
          <div className="brand">Grocery Deals</div>
        </div>
        <button className="ghost" onClick={logout}>
          Sign out
        </button>
      </header>

      <div className={`chat-window ${hasExpandedContent ? "expanded" : "compact"}`}>
        <div className="chat-window-header">
          <div className="feature-copy">
            <h2>Features</h2>
            <p>Chat stays available by default. Pick another feature when needed.</p>
          </div>
          <section className="feature-panel">
            <label className="feature-select">
              <span>Select a feature</span>
              <select value={selectedFeature} onChange={(e) => setSelectedFeature(e.target.value)}>
                <option value="chat">Chat</option>
                <option value="receipt">Upload receipt</option>
                <option value="weeklyDeals">Generate weekly deals</option>
              </select>
            </label>
          </section>
        </div>

        {selectedFeature === "receipt" ? (
          <section className="receipt-panel">
            <button
              className={`receipt-toggle ${receiptExpanded ? "expanded" : ""}`}
              type="button"
              onClick={() => setReceiptExpanded((prev) => !prev)}
              aria-expanded={receiptExpanded}
            >
              <div className="receipt-copy">
                <h2>Upload receipt</h2>
                <p>Send a `.jpeg`, `.jpg`, or `.png` grocery receipt to extract line items.</p>
              </div>
              <span className="receipt-toggle-icon">{receiptExpanded ? "−" : "+"}</span>
            </button>

            {receiptExpanded ? (
              <>
                <form className="receipt-form" onSubmit={handleReceiptUpload}>
                  <label className="file-input">
                    <span>Receipt image</span>
                    <input type="file" accept="image/jpeg,image/png" onChange={handleReceiptFileChange} />
                  </label>
                  <button className="primary" type="submit" disabled={receiptLoading}>
                    {receiptLoading ? "Uploading…" : "Analyze receipt"}
                  </button>
                </form>

                {receiptFile ? <p className="receipt-meta">Selected file: {receiptFile.name}</p> : null}
                {receiptError ? <p className="error">{receiptError}</p> : null}
                {saveMessage ? <p className="success">{saveMessage}</p> : null}
                <ReceiptItemsTable
                  items={receiptItems}
                  onChange={handleReceiptItemChange}
                  onAddRow={handleAddReceiptRow}
                  onDeleteRow={handleDeleteReceiptRow}
                  onSave={handleSaveProducts}
                  saveLoading={saveLoading}
                />
              </>
            ) : null}
          </section>
        ) : null}

        {selectedFeature === "weeklyDeals" ? (
          <section className="receipt-panel">
            <div className="receipt-results-header">
              <div>
                <h2>Generate weekly deals</h2>
                <p>Load the latest weekly deals and compare providers in one table.</p>
              </div>
              <div className="receipt-actions">
                <button
                  className="primary"
                  type="button"
                  onClick={handleGenerateWeeklyDeals}
                  disabled={weeklyDealsLoading}
                >
                  {weeklyDealsLoading ? "Generating…" : "Generate weekly deals"}
                </button>
              </div>
            </div>

            {weeklyDealsError ? <p className="error">{weeklyDealsError}</p> : null}
            <WeeklyDealsTable products={weeklyDealsProducts} week={weeklyDealsWeek} />
          </section>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "assistant" ? <AssistantMessage content={m.content} /> : <pre>{m.text}</pre>}
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Ask about weekly grocery deals. Example: Show me the deals on tea."
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
