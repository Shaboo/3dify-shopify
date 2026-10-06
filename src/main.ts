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
app.innerHTML = `<s-page heading="3dify"><s-section heading="Create 3D models from product photos"><s-paragraph>Choose photos showing different views of your product, and we will automatically add the finished model to the selected product. You can close this page while it runs.</s-paragraph></s-section><div id="notice" role="status" aria-live="polite"></div><s-section heading="Your plan"><p id="subscription">Connecting to your store…</p><s-button id="pricing" disabled>Manage plan</s-button><s-button id="refresh">Refresh</s-button></s-section><s-section heading="New model"><form id="generation"><button type="button" id="choose-product">Choose product</button><p id="selected-product">Choose a saved product to get started.</p><div id="product-photos"></div><label>Photo source<select id="photo-source"><option value="product">Use photos already on the product</option><option value="upload">Upload different photos</option></select></label><div id="upload-photos" class="images" hidden><label>Product photos<input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div><p id="photo-limits">Loading photo limits…</p><p>JPEG, PNG or WebP, up to 20 MB each. Accepted generations use one allowance, including models that fail.</p><button type="submit" id="generate">Generate model</button><button type="button" id="new-request">Start a new request</button><p id="retry"></p></form></s-section><s-section heading="Your models"><div id="models"></div><button id="more" hidden>Load more</button></s-section></s-page>`;
const notice = (message: string, error = false) => {
  const el = document.querySelector<HTMLElement>("#notice")!;
  el.textContent = message;
  el.dataset.error = String(error);
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";
let selectedProduct: import("./api").Product | undefined;
let selectedPhotoIds: string[] = [];
let photoOptions: import("./api").GenerationOptions | undefined;
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
  generate.disabled = value || !connected || !photoOptions;
  form
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")
    .forEach((input) => (input.disabled = value || failedRequest));
  document.querySelector<HTMLButtonElement>("#choose-product")!.disabled =
    value || failedRequest || !connected;
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
  function renderProductPhotos() {
    const gallery = document.querySelector("#product-photos")!;
    gallery.replaceChildren();
    document.querySelector("#selected-product")!.textContent =
      selectedProduct?.title || "Choose a saved product to get started.";
    if (!selectedProduct) return;
    if (!selectedProduct.images.length)
      gallery.textContent =
        "This product has no photos yet. Save photos on the product or choose Upload different photos.";
    for (const photo of selectedProduct.images) {
      const label = document.createElement("label");
      const image = document.createElement("img");
      image.src = photo.url;
      image.alt = photo.alt || "Product photo";
      image.loading = "lazy";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = photo.id;
      checkbox.name = "product-photo";
      checkbox.checked = selectedPhotoIds.includes(photo.id);
      checkbox.addEventListener("change", () => {
        selectedPhotoIds = checkbox.checked
          ? [...selectedPhotoIds, photo.id]
          : selectedPhotoIds.filter((id) => id !== photo.id);
      });
      label.append(image, checkbox);
      gallery.append(label);
    }
    const guidance = document.createElement("p");
    guidance.textContent =
      "Select the front view first, then other useful angles of the same product.";
    gallery.append(guidance);
    setBusy(busy);
  }
  document
    .querySelector("#choose-product")!
    .addEventListener("click", async () => {
      if (busy || failedRequest) return;
      try {
        const selection = await bridge.resourcePicker({
          type: "product",
          multiple: false,
        });
        if (!selection?.[0]) return;
        setBusy(true);
        selectedProduct = await api.productImages(selection[0].id);
        selectedPhotoIds = [];
        form.reset();
        renderProductPhotos();
        document.querySelector<HTMLElement>("#upload-photos")!.hidden = true;
        document.querySelector<HTMLElement>("#product-photos")!.hidden = false;
      } catch (error) {
        notice(errorText(error), true);
      } finally {
        setBusy(false);
      }
    });
  document.querySelector("#photo-source")!.addEventListener("change", () => {
    const upload =
      document.querySelector<HTMLSelectElement>("#photo-source")!.value ===
      "upload";
    document.querySelector<HTMLElement>("#upload-photos")!.hidden = !upload;
    document.querySelector<HTMLElement>("#product-photos")!.hidden = upload;
  });
  async function refreshPhotoOptions() {
    photoOptions = await api.generationOptions();
    document.querySelector("#photo-limits")!.textContent =
      photoOptions.maxImages === null
        ? "Choose one or more photos showing useful, consistent angles of the same product."
        : `Choose ${photoOptions.minImages}–${photoOptions.maxImages} photos showing useful, consistent angles of the same product.`;
    setBusy(busy);
  }
  async function refreshPlan() {
    subscription = await api.subscription();
    document.querySelector("#subscription")!.textContent =
      `${subscription.planName || "No active plan"} · ${subscription.status} · ${subscription.generationsConsumed} / ${subscription.generationLimit} generations used${subscription.allowancePeriodEnd ? ` · allowance renews ${new Date(subscription.allowancePeriodEnd).toLocaleDateString()}` : ""}${subscription.periodEnd ? ` · billing period ends ${new Date(subscription.periodEnd).toLocaleDateString()}` : ""}`;
    document.querySelector("#pricing")!.removeAttribute("disabled");
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
      if (model.productId) {
        const attachment = document.createElement("p");
        const states: Record<string, string> = {
          waiting: "Will be attached automatically when generation finishes",
          retrying: "Retrying attachment",
          checking: "Checking Shopify attachment",
          processing: "Shopify is processing the model",
          attached: "Attached to product",
          failed: "Attachment needs attention",
          canceled: "Attachment canceled",
        };
        attachment.textContent = `${states[model.attachmentStatus || "waiting"] || "Waiting for attachment"}${model.attachmentError ? ` · ${model.attachmentError}` : ""}`;
        card.append(attachment);
        const link = document.createElement("a");
        link.href = `shopify://admin/products/${model.productId.split("/").at(-1)}`;
        link.textContent = "Open product";
        link.target = "_top";
        card.append(link);
      }
      if (
        !model.productId &&
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
    const images = inputs.flatMap((x) => Array.from(x.files || []));
    try {
      if (!photoOptions) throw new Error("Wait for photo limits to load.");
      if (!selectedProduct) throw new Error("Choose a product first.");
      const useProductPhotos =
        document.querySelector<HTMLSelectElement>("#photo-source")!.value ===
        "product";
      if (useProductPhotos) {
        if (
          selectedPhotoIds.length < photoOptions.minImages ||
          (photoOptions.maxImages !== null &&
            selectedPhotoIds.length > photoOptions.maxImages)
        )
          throw new Error(
            `Choose ${photoOptions.minImages}–${photoOptions.maxImages ?? "any number of"} product photos.`,
          );
      } else validateImages(images, photoOptions);
      requestKey ||= crypto.randomUUID();
      setBusy(true);
      const result = useProductPhotos
        ? await api.generateProduct(
            selectedProduct.id,
            selectedPhotoIds,
            requestKey,
          )
        : await api.generate(images, requestKey, selectedProduct.id);
      notice(
        `Generation accepted. The model will be attached automatically; you can close this page. Job ${result.jobId}`,
      );
      requestKey = null;
      failedRequest = false;
      form.reset();
      selectedPhotoIds = [];
      renderProductPhotos();
      document.querySelector<HTMLElement>("#upload-photos")!.hidden = true;
      document.querySelector<HTMLElement>("#product-photos")!.hidden = false;
      retry.textContent = "";
      models = [];
      cursor = null;
      const refreshed = await Promise.allSettled([
        loadMore(),
        refreshPlan(),
        refreshPhotoOptions(),
      ]);
      if (refreshed.some((result) => result.status === "rejected"))
        notice(
          "Generation accepted and queued for automatic attachment. Some status information could not refresh; use Refresh to check progress.",
          true,
        );
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
    selectedPhotoIds = [];
    renderProductPhotos();
    document.querySelector<HTMLElement>("#upload-photos")!.hidden = true;
    document.querySelector<HTMLElement>("#product-photos")!.hidden = false;
    retry.textContent = "";
    setBusy(false);
  });
  document.querySelector("#pricing")!.addEventListener("click", () => {
    try {
      if (!subscription) return;
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
      await Promise.all([loadMore(), refreshPlan(), refreshPhotoOptions()]);
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
      await Promise.all([refreshPlan(), loadMore(), refreshPhotoOptions()]);
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
