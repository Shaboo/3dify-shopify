/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { backendClient, isRunning } from "../../../src/api";
import { backendUrl } from "./backend-url";

export default async () => {
  render(<ProductModel />, document.body);
};

function ProductModel() {
  const productId = shopify.data.selected[0]?.id;
  const api = useMemo(
    () =>
      backendUrl
        ? backendClient(backendUrl, () => shopify.auth.idToken())
        : null,
    [],
  );
  const [product, setProduct] = useState(null);
  const [options, setOptions] = useState(null);
  const [selected, setSelected] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [requestKey, setRequestKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    if (!api || !productId) return;
    await api.connect();
    const [current, limits, page] = await Promise.all([
      api.productImages(productId),
      api.generationOptions(),
      api.models(),
    ]);
    setProduct(current);
    setOptions(limits);
    setJobs(page.models.filter((job) => job.productId === productId));
  }
  useEffect(() => {
    let active = true;
    if (!api || !productId) {
      setLoading(false);
      return;
    }
    load()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);
  useEffect(() => {
    if (!api || !jobs.some(isRunning)) return;
    let active = true;
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const updates = await Promise.all(
          jobs.map((job) => (isRunning(job) ? api.model(job.id) : job)),
        );
        if (active) setJobs(updates);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        running = false;
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobs]);
  async function generate() {
    if (!api || !product || !options || busy) return;
    if (
      selected.length < options.minImages ||
      (options.maxImages !== null && selected.length > options.maxImages)
    ) {
      setError(
        `Choose ${options.minImages}–${options.maxImages ?? "any number of"} photos.`,
      );
      return;
    }
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    setBusy(true);
    setError("");
    try {
      const result = await api.generateProduct(product.id, selected, key);
      setRequestKey(null);
      setSelected([]);
      setMessage(
        "Generation started. The model will be attached automatically; you can leave this page.",
      );
      const model = await api.model(result.jobId);
      setJobs((old) => [model, ...old.filter((job) => job.id !== model.id)]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    waiting: "Waiting for generation",
    retrying: "Retrying attachment",
    checking: "Checking Shopify attachment",
    processing: "Shopify is processing the model",
    attached: "Attached to product",
    failed: "Attachment needs attention",
    canceled: "Attachment canceled",
  };
  return (
    <s-admin-block heading="Generate 3D model">
      <s-stack gap="base">
        {!api && (
          <s-banner tone="critical">
            Configure the app backend URL, then restart Shopify development.
          </s-banner>
        )}
        {!productId && (
          <s-text>Save this product before generating a model.</s-text>
        )}
        {loading && <s-spinner />}
        {error && <s-banner tone="critical">{error}</s-banner>}
        {message && <s-banner tone="success">{message}</s-banner>}
        {product && options && (
          <>
            <s-text>
              Select {options.minImages}–{options.maxImages ?? "any number of"}{" "}
              photos. Select the front view first, then other angles of the same
              product.
            </s-text>
            {!product.images.length && (
              <s-text>Add photos to the product and save it first.</s-text>
            )}
            {product.images.map((photo) => (
              <s-stack key={photo.id} direction="inline" gap="base">
                <s-thumbnail size="large" src={photo.url} alt={photo.alt || "Product photo"} />
                <s-checkbox
                  label={
                    photo.alt || `Photo ${product.images.indexOf(photo) + 1}`
                  }
                  checked={selected.includes(photo.id)}
                  disabled={busy || !!requestKey}
                  onChange={(event) =>
                    setSelected((old) =>
                      event.currentTarget.checked
                        ? [...old, photo.id]
                        : old.filter((id) => id !== photo.id),
                    )
                  }
                />
              </s-stack>
            ))}
            <s-button
              variant="primary"
              disabled={busy || !product.images.length}
              onClick={generate}
            >
              {requestKey ? "Retry same request" : "Generate model"}
            </s-button>
            {requestKey && (
              <>
                <s-text>
                  Retry preserves the selected photos and request ID to prevent
                  duplicate generation.
                </s-text>
                <s-button
                  disabled={busy}
                  onClick={() => {
                    setRequestKey(null);
                    setSelected([]);
                    setError("");
                  }}
                >
                  Start a new request
                </s-button>
              </>
            )}
          </>
        )}
        {jobs.map((job) => (
          <s-stack key={job.id} gap="small">
            <s-text>
              {job.status} ·{" "}
              {labels[job.attachmentStatus] || "Waiting for attachment"}
            </s-text>
            {(job.attachmentError || job.errorMessage) && (
              <s-text>{job.attachmentError || job.errorMessage}</s-text>
            )}
          </s-stack>
        ))}
        {!loading && api && (
          <s-button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await load();
                setError("");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh
          </s-button>
        )}
      </s-stack>
    </s-admin-block>
  );
}
