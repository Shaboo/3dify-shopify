import {
  backendClient,
  validateImages,
  pricingDestination,
  isRunning,
  type Model,
  type Subscription,
} from "./api";
import { attachModel, findAttachment, waitForAttachment } from "./shopify";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<s-page heading="3dify"><s-section heading="Create 3D models from product photos"><s-paragraph>Upload two views of your product, then add the finished model to its Shopify product.</s-paragraph></s-section><div id="notice" role="status" aria-live="polite"></div><s-section heading="Your plan"><p id="subscription">Connecting to your store…</p><s-button id="pricing">Manage plan</s-button><s-button id="refresh">Refresh</s-button></s-section><s-section heading="New model"><form id="generation"><div class="images"><label>First view<input name="image1" type="file" accept="image/jpeg,image/png,image/webp" required></label><label>Second view<input name="image2" type="file" accept="image/jpeg,image/png,image/webp" required></label></div><p>JPEG, PNG or WebP, up to 20 MB each. Accepted generations use one allowance, including models that fail.</p><button type="submit" id="generate">Generate model</button><button type="button" id="new-request">Start a new request</button><p id="retry"></p></form></s-section><s-section heading="Your models"><div id="models"></div><button id="more" hidden>Load more</button></s-section></s-page>`;
const notice = (message: string, error = false) => {
  const el = document.querySelector<HTMLElement>("#notice")!;
  el.textContent = message;
  el.dataset.error = String(error);
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";
let subscription: Subscription | undefined;
let models: Model[] = [];
let cursor: string | null = null;
let requestKey: string | null = null;
let failedRequest = false;
let busy = false;
let connected = false;
const form = document.querySelector<HTMLFormElement>("#generation")!;
const inputs = Array.from(form.querySelectorAll<HTMLInputElement>("input"));
const generate = document.querySelector<HTMLButtonElement>("#generate")!;
const retry = document.querySelector<HTMLElement>("#retry")!;
const backendUrl = import.meta.env.VITE_BACKEND_URL;
const bridge = window.shopify;
function setBusy(value: boolean) {
  busy = value;
  generate.disabled = value || !connected;
  inputs.forEach((input) => (input.disabled = value || failedRequest));
  document.querySelector<HTMLButtonElement>("#new-request")!.disabled = value;
}
if (
  !backendUrl ||
  !bridge ||
  !import.meta.env.VITE_SHOPIFY_API_KEY ||
  import.meta.env.VITE_SHOPIFY_API_KEY === "replace-with-client-id"
) {
  notice(
    "Configure the public Shopify client ID and backend URL, then open this app from your Shopify admin.",
    true,
  );
  generate.disabled = true;
} else {
  const api = backendClient(backendUrl, () => bridge.idToken());
  async function refreshPlan() {
    subscription = await api.subscription();
    document.querySelector("#subscription")!.textContent =
      `${subscription.planName || "No active plan"} · ${subscription.status} · ${subscription.generationsConsumed} / ${subscription.generationLimit} generations used${subscription.allowancePeriodEnd ? ` · allowance renews ${new Date(subscription.allowancePeriodEnd).toLocaleDateString()}` : ""}${subscription.periodEnd ? ` · billing period ends ${new Date(subscription.periodEnd).toLocaleDateString()}` : ""}`;
  }
  function renderModels() {
    const container = document.querySelector("#models")!;
    container.replaceChildren();
    if (!models.length) {
      container.textContent = "Your models will appear here.";
    }
    for (const model of models) {
      const card = document.createElement("article");
      const title = document.createElement("h3");
      title.textContent = `${new Date(model.createdAt).toLocaleString()} · ${model.status}`;
      card.append(title);
      const detail = document.createElement("p");
      detail.textContent = model.errorMessage || `Model ${model.id}`;
      card.append(detail);
      if (
        ["SUCCESS", "COMPLETED"].includes(model.status) &&
        model.outputGlbUrl
      ) {
        const button = document.createElement("button");
        button.textContent = "Add to product";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const selected = await bridge!.resourcePicker({
              type: "product",
              multiple: false,
            });
            if (!selected?.[0]) return;
            const existing = await findAttachment(selected[0].id, model.id);
            if (!existing)
              await attachModel(selected[0].id, model.outputGlbUrl!, model.id);
            notice(`Shopify is processing the model for ${selected[0].title}.`);
            const status = await waitForAttachment(selected[0].id, model.id);
            if (status === "READY")
              notice(`Model ready on ${selected[0].title}.`);
            else if (status === "FAILED")
              notice(
                `Shopify could not process this model. Remove the failed media from ${selected[0].title} in Shopify, then try adding the model again.`,
                true,
              );
            else
              notice(
                `Shopify is still processing the model for ${selected[0].title}. Check the product or select it again here to refresh the status.`,
              );
          } catch (error) {
            notice(errorText(error), true);
          } finally {
            button.disabled = false;
          }
        });
        card.append(button);
      }
      container.append(card);
    }
    document.querySelector<HTMLButtonElement>("#more")!.hidden = !cursor;
  }
  async function loadMore() {
    const page = await api.models(cursor || undefined);
    const all = new Map(models.map((x) => [x.id, x]));
    page.models.forEach((x) => all.set(x.id, x));
    models = [...all.values()];
    cursor = page.nextCursor;
    renderModels();
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !connected) return;
    const images = inputs
      .map((x) => x.files?.[0])
      .filter((x): x is File => !!x);
    try {
      validateImages(images);
      requestKey ||= crypto.randomUUID();
      setBusy(true);
      const result = await api.generate(images, requestKey);
      notice(`Generation accepted: ${result.jobId}`);
      requestKey = null;
      failedRequest = false;
      form.reset();
      retry.textContent = "";
      models = [];
      cursor = null;
      await Promise.all([loadMore(), refreshPlan()]);
    } catch (error) {
      failedRequest = requestKey !== null;
      retry.textContent = failedRequest
        ? "Retry sends the same images and request ID, preventing another allowance charge. Use “Start a new request” to choose different images."
        : "";
      notice(errorText(error), true);
    } finally {
      setBusy(false);
    }
  });
  document.querySelector("#new-request")!.addEventListener("click", () => {
    requestKey = null;
    failedRequest = false;
    form.reset();
    retry.textContent = "";
    setBusy(false);
  });
  document.querySelector("#pricing")!.addEventListener("click", () => {
    try {
      if (!subscription) throw new Error("Refresh your plan first");
      window.open(pricingDestination(subscription.pricingUrl), "_top");
    } catch (error) {
      notice(errorText(error), true);
    }
  });
  document
    .querySelector("#more")!
    .addEventListener("click", () =>
      loadMore().catch((error) => notice(errorText(error), true)),
    );
  document.querySelector("#refresh")!.addEventListener("click", async () => {
    try {
      if (!connected) {
        await api.connect();
        connected = true;
        setBusy(false);
      }
      models = [];
      cursor = null;
      await Promise.all([loadMore(), refreshPlan()]);
      notice("Store refreshed.");
    } catch (error) {
      notice(errorText(error), true);
    }
  });
  setBusy(false);
  void (async () => {
    try {
      await api.connect();
      connected = true;
      setBusy(false);
      await Promise.all([refreshPlan(), loadMore()]);
      notice("Store connected.");
    } catch (error) {
      notice(errorText(error), true);
    }
  })();
  let polling = false;
  setInterval(async () => {
    if (polling || document.hidden || !connected) return;
    const pending = models.filter(isRunning);
    if (!pending.length) return;
    polling = true;
    try {
      const updates = await Promise.all(pending.map((x) => api.model(x.id)));
      const byId = new Map(updates.map((x) => [x.id, x]));
      models = models.map((x) => byId.get(x.id) || x);
      renderModels();
    } catch (error) {
      notice(errorText(error), true);
    } finally {
      polling = false;
    }
  }, 5000);
}
